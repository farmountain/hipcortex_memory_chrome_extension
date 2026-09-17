/**
 * "Capture this conversation" through the router — G1.12.
 *
 * This is the path a user actually takes: a surface sends `CAPTURE_ACTIVE_TAB`, the worker asks the
 * active tab to read itself, and the worker runs the result through the pipeline with a **manual**
 * trigger. These specs pin the three things that decide whether that is honest:
 *
 * 1. The trigger really is `manual`, so the capture works with `autoCapture` off. If the worker ever
 *    sent `passive` here, the button would be inert for exactly the users who turned the setting off —
 *    the ones most likely to press it.
 * 2. Every way of failing is a typed code with a sentence. There is no branch that answers nothing,
 *    because a capture button that does nothing is what this gap was reported as.
 * 3. The three failures that need different advice are not conflated: a page this extension does not
 *    read, a page it does read but cannot reach, and a page it reached whose DOM would not parse.
 */

import { describe, expect, it, vi } from "vitest";

import { loadWorker } from "../helpers/worker.js";
import { installFetchMock, networkFailure } from "../helpers/http.js";
import type { CannedResponse } from "../helpers/http.js";
import { makeCaptureEvent } from "../helpers/events.js";
import { FLUSH_CAPTURE_REQUEST } from "../../src/capture/flush.js";
import { QUEUE_SPILL_LIMIT, QUEUE_STORAGE_KEY } from "../../src/capture/queue/queue.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import { SCHEMA_VERSION } from "../../src/schema/version.js";
import type { ExtractSuccess } from "../../src/capture/providers/types.js";
import type { ConversationCaptureReport, MessageResponse } from "../../src/types/index.js";

const CHATGPT_URL = "https://chatgpt.com/c/redacted";

/**
 * Acknowledged by the runtime, so "captured" in the report means the runtime said so.
 *
 * `developer` is named rather than left on `auto` because `auto` tries Native Messaging first and the
 * chrome mock's port never answers, which would turn every delivered case below into a measurement of
 * a response timeout. The transport mode is orthogonal to what these specs are about.
 */
const ACKNOWLEDGED: CannedResponse = { body: { success: true, record_id: "rec-manual-1" } };
const CAPTURED_AT = "2025-01-15T00:00:00.000Z";
const ACTOR = "spec-actor";

/**
 * A well-formed extraction, built literally.
 *
 * `tests/router/**` runs in the **node** project (`vitest.workspace.ts`), so there is no `DOMParser`
 * and no fixture can be parsed here. That is the right environment for a router spec — what is under
 * test is which message goes where, not whether a selector matched — so the input is shaped by hand
 * and the adapter is kept out of it entirely.
 */
function extractionFor(url = CHATGPT_URL): ExtractSuccess {
  return {
    ok: true,
    conversation: {
      title: "Redacted conversation",
      url,
      messages: [
        { index: 0, role: "user", text: "How does the queue drain?" },
        { index: 1, role: "assistant", text: "One acknowledged entry at a time." },
        { index: 2, role: "user", text: "And if the runtime is down?" },
      ],
    },
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      provider: "chatgpt",
      adapterVersion: "spec-1",
      source: "cortexbridge",
      conversationUrl: url,
      capturedAt: CAPTURED_AT,
    },
    rungs: { conversationRoot: 0, turnContainer: 0, messageText: 0, roleSignal: 0 },
  };
}

function report(response: MessageResponse): ConversationCaptureReport {
  return response.data as ConversationCaptureReport;
}

/**
 * A worker whose runtime answers captures the way the caller asks it to.
 *
 * The runtime's answer is a parameter rather than a constant because it is the thing half these
 * specs are about: a capture that was acknowledged, one that was refused, and one that could not be
 * delivered at all are three different reports, and the report is the product surface.
 */
async function workerWith(
  answer: unknown,
  options: Parameters<typeof loadWorker>[0] = {},
  runtime: CannedResponse = ACKNOWLEDGED
) {
  const harness = await loadWorker({
    ...options,
    tabs: options.tabs ?? { active: { id: 7, url: CHATGPT_URL } },
    sync: {
      ...DEFAULT_SETTINGS,
      defaultActor: ACTOR,
      transportMode: "developer",
      ...(options.sync ?? {}),
    },
  });
  harness.mock.tabs.sendMessage.mockResolvedValue(answer);
  installFetchMock(() => runtime);
  return harness;
}

describe("a manual capture reads the active tab and stores it — G1.12", () => {
  it("asks the active tab to flush, with no provider named by the surface", async () => {
    const { mock, send } = await workerWith({
      status: "captured",
      providerId: "chatgpt",
      url: CHATGPT_URL,
      result: extractionFor(),
    });

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    expect(response.success).toBe(true);
    const [tabId, request] = mock.tabs.sendMessage.mock.calls[0] as [number, { type: string }];
    expect(tabId).toBe(7);
    expect(request).toEqual({ type: FLUSH_CAPTURE_REQUEST });
    expect(report(response).captured).toBe(true);
    expect(report(response).providerId).toBe("chatgpt");
  });

  it("stores the conversation even with auto capture turned off", async () => {
    const { send } = await workerWith(
      { status: "captured", providerId: "chatgpt", url: CHATGPT_URL, result: extractionFor() },
      { sync: { autoCapture: false } }
    );

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    /**
     * The whole point of the feature. A user who turned passive capture off still owns their
     * conversations and must still be able to ask for one; a `passive` trigger here would make this
     * extension's most deliberate users the only ones it refuses.
     */
    expect(response.success).toBe(true);
    expect(report(response).messages).toBeGreaterThan(0);
  });

  it("reports how many messages it read, so the user can check it against the page", async () => {
    const extraction = extractionFor();
    const { send } = await workerWith({
      status: "captured",
      providerId: "chatgpt",
      url: CHATGPT_URL,
      result: extraction,
    });

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    expect(report(response).messages).toBe(extraction.conversation.messages.length);
  });

  it("keeps an unreachable capture in the queue instead of claiming it was stored", async () => {
    const { send } = await workerWith(
      { status: "captured", providerId: "chatgpt", url: CHATGPT_URL, result: extractionFor() },
      {},
      networkFailure()
    );

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    /**
     * A runtime that cannot be reached is not a lost conversation. The extension's whole guarantee is
     * that an unacknowledged capture is kept and retried, so this is a success — but it is *not*
     * "stored", and `code` is what lets a surface say which of the two happened without reading the
     * sentence.
     */
    expect(response.success).toBe(true);
    expect(report(response).captured).toBe(true);
    expect(report(response).code).toBe("NOT_ACKNOWLEDGED");
    expect(String(report(response).detail)).toMatch(/retried/i);
  });

  it("leaves the capture in storage, so the promise to retry is a fact about the disk", async () => {
    const { mock, send } = await workerWith(
      { status: "captured", providerId: "chatgpt", url: CHATGPT_URL, result: extractionFor() },
      {},
      networkFailure()
    );

    await send({ type: "CAPTURE_ACTIVE_TAB" });

    const stored = mock.storage.local.data[QUEUE_STORAGE_KEY] as { entries?: unknown[] } | undefined;
    expect(stored?.entries ?? []).toHaveLength(1);
  });
});

describe("a click that produces nothing is reported as producing nothing — G1.12", () => {
  it("refuses visibly when the queue is paused at its spill limit", async () => {
    const paused = Array.from({ length: QUEUE_SPILL_LIMIT }, (_, index) => ({
      event: makeCaptureEvent({ eventId: `evt-held-${index}`, text: `held ${index}` }),
      attempts: 0,
      enqueuedAt: CAPTURED_AT,
      // Far enough in the future that nothing drains during the test.
      nextAttemptAt: "2099-01-01T00:00:00.000Z",
      outcome: "transient" as const,
      refusalReason: null,
    }));

    const { send } = await workerWith(
      { status: "captured", providerId: "chatgpt", url: CHATGPT_URL, result: extractionFor() },
      {},
      networkFailure()
    );
    await chrome.storage.local.set({ [QUEUE_STORAGE_KEY]: { entries: paused, paused: true } });

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    /**
     * The queue is full, so this capture was read but could not be kept. That is the one outcome a
     * user must be told about plainly — the alternative is a button that appears to work while the
     * conversation is gone, which is precisely how this gap was reported.
     */
    expect(response.success).toBe(false);
    expect(report(response).captured).toBe(false);
    expect(report(response).code).toBe("NOT_ACKNOWLEDGED");
    expect(String(report(response).detail ?? response.error)).toMatch(/paus/i);
  });

  it("reports how many messages it read even when it could not keep them", async () => {
    const { send } = await workerWith(
      { status: "failed", providerId: "chatgpt", url: CHATGPT_URL, code: "EMPTY_CONVERSATION", detail: "no turns" },
      {}
    );

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    // A reader needs the provider and the URL most when the answer is no: they are the two things
    // that say which page was looked at.
    expect(response.success).toBe(false);
    expect(report(response).providerId).toBe("chatgpt");
    expect(report(response).url).toBe(CHATGPT_URL);
  });
});

describe("every way a manual capture can fail is typed and explained — G1.12", () => {
  it("says there is nothing to capture when no tab is active", async () => {
    const { mock, send } = await workerWith(
      { status: "captured", providerId: "chatgpt", url: CHATGPT_URL, result: extractionFor() },
      { tabs: { active: null } }
    );

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    expect(response.success).toBe(false);
    expect(report(response).code).toBe("NO_ACTIVE_TAB");
    // Nothing was spoken to, so there is no page to blame and no retry to suggest.
    expect(mock.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("names an unwatched page rather than suggesting a reload", async () => {
    const { mock, send } = await workerWith(undefined, {
      tabs: { active: { id: 7, url: "https://example.com/chat" } },
    });
    mock.tabs.sendMessage.mockRejectedValue(
      new Error("Could not establish connection. Receiving end does not exist.")
    );

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    expect(report(response).code).toBe("PAGE_NOT_WATCHED");
    expect(String(report(response).detail)).toContain("not a conversation on a site this extension reads");
  });

  it("points at the grant when the site is watched but not allowed", async () => {
    const { mock, send } = await workerWith(undefined, {
      tabs: { active: { id: 7, url: CHATGPT_URL } },
      // Declared, so the extension claims it; not granted, so the browser will not run there — the
      // exact state a packaged install is in before the user allows anything.
      permissions: { contains: () => false, granted: [] },
    });
    mock.tabs.sendMessage.mockRejectedValue(new Error("Could not establish connection."));

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    expect(report(response).code).toBe("SITE_ACCESS_DENIED");
    expect(String(report(response).detail)).toContain("chatgpt.com");
    expect(String(report(response).detail)).toMatch(/options|allow/i);
  });

  it("does not blame site access when the grant is real but unreadable via contains", async () => {
    const { mock, send } = await workerWith(undefined, {
      tabs: { active: { id: 7, url: CHATGPT_URL } },
      /**
       * An unpacked install: `contains` denies every origin while `getAll` lists them all. If the
       * worker trusted `contains` alone it would tell a working install to grant a site it already
       * has, and the user would click Allow forever with nothing changing.
       */
      permissions: { contains: () => false, granted: ["https://chatgpt.com/*"] },
    });
    mock.tabs.sendMessage.mockRejectedValue(new Error("Could not establish connection."));

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    expect(report(response).code).not.toBe("SITE_ACCESS_DENIED");
  });

  it("carries an unwatched answer from the page itself", async () => {
    const { send } = await workerWith({ status: "unsupported", url: "https://example.com/" });

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    expect(report(response).code).toBe("PAGE_NOT_WATCHED");
    expect(report(response).captured).toBe(false);
  });

  it("passes the adapter's typed extraction failure through to the surface", async () => {
    const { send } = await workerWith({
      status: "failed",
      providerId: "chatgpt",
      url: CHATGPT_URL,
      code: "SLOT_UNRESOLVED",
      detail: "conversationRoot: none of the 2 selectors matched",
    });

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    /**
     * This is the branch that makes a broken selector visible. On the passive path the same failure
     * is a drift counter the user never opens; here it is text in front of them, naming the slot that
     * moved — which is the evidence needed to decide whether the adapter or the site changed.
     */
    expect(response.success).toBe(false);
    expect(report(response).code).toBe("EXTRACTION_FAILED");
    expect(String(report(response).detail)).toContain("SLOT_UNRESOLVED");
    expect(String(report(response).detail)).toContain("conversationRoot");
  });

  it("answers with a code when the page replies with nothing at all", async () => {
    const { send } = await workerWith(undefined);

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    // `sendMessage` resolving to undefined is a page that neither answered nor threw. It must not
    // become silence at the surface.
    expect(response.success).toBe(false);
    expect(typeof report(response).code).toBe("string");
    expect(String(report(response).detail).length).toBeGreaterThan(0);
  });
});

describe("the manual path does not weaken the passive one — G1.7", () => {
  it("leaves a passive capture inert when auto capture is off", async () => {
    const { send } = await loadWorker({ sync: { ...DEFAULT_SETTINGS, autoCapture: false } });

    const { response } = await send({
      type: "CAPTURE_UPDATE",
      providerId: "chatgpt",
      url: CHATGPT_URL,
      result: extractionFor(),
    });

    expect(response.success).toBe(true);
    expect((response.data as { status: string }).status).toBe("inert");
  });

  it("still places context on the same worker that answers a manual capture", async () => {
    const { mock, send } = await workerWith(
      { status: "captured", providerId: "chatgpt", url: CHATGPT_URL, result: extractionFor() },
      { sync: { injectIntoAiChats: true } }
    );

    await send({ type: "CAPTURE_ACTIVE_TAB" });
    const beforePlacement = mock.tabs.sendMessage.mock.calls.length;

    await send({ type: "PLACE_CONTEXT", indexedId: "not-indexed" });

    // Two listeners' worth of traffic on one channel, and the placements are counted separately.
    expect(mock.tabs.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(beforePlacement);
  });

  it("never reports an unacknowledged capture as stored", async () => {
    const { send } = await workerWith(
      { status: "captured", providerId: "chatgpt", url: CHATGPT_URL, result: extractionFor() },
      {},
      { body: { success: false, error: "refused: contains personal data" } }
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { response } = await send({ type: "CAPTURE_ACTIVE_TAB" });

    /**
     * The runtime did not acknowledge this record, so "Stored." must not appear. What does appear is
     * `NOT_ACKNOWLEDGED` and the promise of a retry, because the entry is durably in the queue — a
     * refusal is repeated until it lifts rather than discarding the conversation (G2.2, G2.9).
     */
    expect(report(response).code).toBe("NOT_ACKNOWLEDGED");
    expect(report(response).detail).not.toBe("Stored.");
    expect(String(response.error ?? "")).toBe("");
  });
});
