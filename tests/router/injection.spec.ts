/**
 * The worker's half of placing context (task 4.1, G4.5).
 *
 * The page decides *where* text goes; the worker decides *whether* it may be asked at all, and which
 * text. That split is what this spec pins:
 *
 * 1. With the setting off the router refuses **by name** and never speaks to a tab. The interesting
 *    assertion is the negative one — a refusal that still messaged the page would satisfy "off" only
 *    in the response body.
 * 2. With it on, the router looks the record up in the index it actually wrote, hands the *page* the
 *    text and the provider it came from, and relays whatever the page reports. It does not inspect
 *    `tab.url` to pre-judge the provider: reading that needs a host permission this extension does
 *    not request, and the page is the only place that knows its own DOM.
 * 3. Turning the setting off does not turn capture off. The two directions of G4.5 — capture in,
 *    placement out — share no switch, and this is the test that would fail if they did.
 *
 * This is a node spec: the router is driven as the shipped module against the chrome mock, with no
 * DOM anywhere, because nothing in this path reads one.
 */

import { describe, expect, it } from "vitest";

import { loadWorker } from "../helpers/worker.js";
import { makeIndexRecord, seedIndex, storedRecords } from "../helpers/index-store.js";
import { installFetchMock, networkFailure } from "../helpers/http.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import type { MessageResponse } from "../../src/types/index.js";
import type { PlaceContextReport } from "../../src/types/index.js";
import { PLACE_CONTEXT_REQUEST } from "../../src/inject/protocol.js";
import type { PlaceContextReply } from "../../src/inject/protocol.js";
import { chatgptAdapter } from "../../src/capture/providers/chatgpt.js";
import { SCHEMA_VERSION } from "../../src/schema/version.js";
import { CAPTURE_RECORD_TYPE, CAPTURE_SOURCE, captureAction } from "../../src/schema/egress.js";
import type { ExtractSuccess } from "../../src/capture/providers/types.js";

const RECORD_ID = "rec-route-1";
const RECORD_TEXT = "the kubernetes rollout stalled while the readiness probe was flapping";

/** The router answers with the page's report in `data`, or with its own refusal in the same slot. */
function reportOf(response: MessageResponse): PlaceContextReport {
  const data = response.data as PlaceContextReport | undefined;
  if (data === undefined) throw new Error("the router answered with no report");
  return data;
}

/** A worker whose placement setting is on, so the flag gate is not what the test is measuring. */
async function placementWorker() {
  return loadWorker({ sync: { ...DEFAULT_SETTINGS, injectIntoAiChats: true } });
}

/**
 * The extraction a content script would have sent. Declared by hand rather than read from a fixture:
 * this spec owns the *routing* of a capture, and a DOM fixture would make it a second, weaker test of
 * the ChatGPT adapter.
 */
function validExtraction(): ExtractSuccess {
  return {
    ok: true,
    conversation: {
      url: "https://chatgpt.com/c/redacted",
      title: "Redacted conversation",
      messages: [
        { index: 0, role: "user", text: "the kubernetes rollout stalled" },
        { index: 1, role: "assistant", text: "check the readiness probe first" },
      ],
    },
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      provider: chatgptAdapter.id,
      adapterVersion: chatgptAdapter.adapterVersion,
      source: CAPTURE_SOURCE,
      conversationUrl: "https://chatgpt.com/c/redacted",
      capturedAt: "2025-01-15T00:00:00.000Z",
    },
    rungs: { conversationRoot: 0, turnContainer: 0, messageText: 0, roleSignal: 0 },
  };
}

describe("the worker gates placement before it speaks to any page — G4.5 (tasks 2.1, 2.2)", () => {
  it("refuses by name and never messages a tab while the setting is off", async () => {
    const harness = await loadWorker();
    seedIndex(harness.mock, [makeIndexRecord({ recordId: RECORD_ID, text: RECORD_TEXT })]);
    harness.mock.tabs.query.mockResolvedValue([{ id: 42 }]);

    const call = await harness.send({ type: "PLACE_CONTEXT", indexedId: RECORD_ID });

    expect(call.returned).toBe(true);
    expect(call.response.success).toBe(false);
    expect(reportOf(call.response).placed).toBe(false);
    expect(reportOf(call.response).code).toBe("INJECTION_DISABLED");
    // The refusal is the *first* thing the router does: no tab was looked up, none was messaged, so
    // there is nothing for a page to have observed.
    expect(harness.mock.tabs.query).not.toHaveBeenCalled();
    expect(harness.mock.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("places an acknowledged record into the active tab and relays the page's report", async () => {
    const harness = await placementWorker();
    seedIndex(harness.mock, [
      makeIndexRecord({ recordId: RECORD_ID, provider: "chatgpt", text: RECORD_TEXT }),
    ]);
    harness.mock.tabs.query.mockResolvedValue([{ id: 42, url: "https://claude.ai/" }]);
    // A fetch that records instead of answering: placement must issue no request at all, so the
    // handler is a failure that would surface as one if this path ever reached the network
    // (task 3.2). The assertion is the count, not the body.
    const recorder = installFetchMock(() => networkFailure("placing context must not reach the network"));
    const reply: PlaceContextReply = {
      ok: true,
      report: {
        placed: true,
        providerId: "claude",
        sourceProvider: "chatgpt",
        placedChars: RECORD_TEXT.length,
        sourceChars: RECORD_TEXT.length,
        truncated: false,
        maxChars: 2000,
        wroteInto: "text",
        rungs: { composerRoot: 0, composerInput: 0 },
      },
    };
    harness.mock.tabs.sendMessage.mockResolvedValue(reply);

    const call = await harness.send({ type: "PLACE_CONTEXT", indexedId: RECORD_ID });

    expect(harness.mock.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(harness.mock.tabs.sendMessage).toHaveBeenCalledTimes(1);
    const [tabId, message] = harness.mock.tabs.sendMessage.mock.calls[0] as [number, unknown];
    expect(tabId).toBe(42);
    // The page is told the text and where it came from. It is not told a record id, and it is not
    // asked to go and fetch anything.
    expect(message).toEqual({
      type: PLACE_CONTEXT_REQUEST,
      text: RECORD_TEXT,
      sourceProvider: "chatgpt",
    });

    expect(call.response.success).toBe(true);
    expect(reportOf(call.response)).toEqual(reply.report);
    // The worker's whole side of a placement is one message to a tab. Nothing was sent to the core,
    // and the transport was never constructed for this request.
    expect(recorder.urls()).toEqual([]);
  });

  it("relays a page's refusal unchanged rather than turning it into a success", async () => {
    const harness = await placementWorker();
    seedIndex(harness.mock, [makeIndexRecord({ recordId: RECORD_ID })]);
    harness.mock.tabs.query.mockResolvedValue([{ id: 7 }]);
    harness.mock.tabs.sendMessage.mockResolvedValue({
      ok: false,
      report: {
        placed: false,
        code: "COMPOSER_AMBIGUOUS",
        detail: "rung 0 (form textarea) matched 2 nodes",
        providerId: "grok",
      },
    } satisfies PlaceContextReply);

    const call = await harness.send({ type: "PLACE_CONTEXT", indexedId: RECORD_ID });

    expect(call.response.success).toBe(false);
    expect(reportOf(call.response).code).toBe("COMPOSER_AMBIGUOUS");
    expect(call.response.error).toBe("rung 0 (form textarea) matched 2 nodes");
  });

  it("refuses a record the index no longer holds, without messaging a tab", async () => {
    const harness = await placementWorker();

    const call = await harness.send({ type: "PLACE_CONTEXT", indexedId: RECORD_ID });

    expect(call.response.success).toBe(false);
    expect(reportOf(call.response).code).toBe("CONTEXT_NOT_FOUND");
    expect(harness.mock.tabs.query).not.toHaveBeenCalled();
    expect(harness.mock.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses when there is no active tab", async () => {
    const harness = await placementWorker();
    seedIndex(harness.mock, [makeIndexRecord({ recordId: RECORD_ID })]);
    harness.mock.tabs.query.mockResolvedValue([]);

    const call = await harness.send({ type: "PLACE_CONTEXT", indexedId: RECORD_ID });

    expect(call.response.success).toBe(false);
    expect(reportOf(call.response).code).toBe("NO_TARGET_TAB");
    expect(harness.mock.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("reports a tab that has no content script listening", async () => {
    const harness = await placementWorker();
    seedIndex(harness.mock, [makeIndexRecord({ recordId: RECORD_ID })]);
    harness.mock.tabs.query.mockResolvedValue([{ id: 9 }]);
    harness.mock.tabs.sendMessage.mockRejectedValue(
      new Error("Could not establish connection. Receiving end does not exist.")
    );

    const call = await harness.send({ type: "PLACE_CONTEXT", indexedId: RECORD_ID });

    expect(call.response.success).toBe(false);
    expect(reportOf(call.response).code).toBe("TAB_UNREACHABLE");
  });

  it("reports a page that answered with nothing usable", async () => {
    const harness = await placementWorker();
    seedIndex(harness.mock, [makeIndexRecord({ recordId: RECORD_ID })]);
    harness.mock.tabs.query.mockResolvedValue([{ id: 9 }]);
    harness.mock.tabs.sendMessage.mockResolvedValue(undefined);

    const call = await harness.send({ type: "PLACE_CONTEXT", indexedId: RECORD_ID });

    expect(call.response.success).toBe(false);
    expect(reportOf(call.response).code).toBe("TAB_UNREACHABLE");
  });
});

describe("the placement setting does not gate capture — G4.5 (task 2.2)", () => {
  it("still captures, normalizes and delivers while placement is off", async () => {
    // `developer` is named rather than left on `auto` because `auto` tries Native Messaging first and
    // the chrome mock's port never answers, which would make this test a measurement of a response
    // timeout. The transport mode is orthogonal to the flag under test.
    const harness = await loadWorker({
      sync: {
        ...DEFAULT_SETTINGS,
        autoCapture: true,
        injectIntoAiChats: false,
        transportMode: "developer",
      },
    });
    const recorder = installFetchMock(() => ({
      body: { success: true, record_id: "rec-delivered-1" },
    }));

    const call = await harness.send({
      type: "CAPTURE_UPDATE",
      providerId: chatgptAdapter.id,
      url: "https://chatgpt.com/c/redacted",
      result: validExtraction(),
    });

    expect(call.response.success).toBe(true);
    expect(call.response.error).toBeUndefined();
    // One route in, and it is the memory endpoint — the capture direction has no other door.
    expect(recorder.urls()).toEqual(["http://127.0.0.1:3030/memory/add"]);
    // Normalization happened rather than a raw blob being forwarded: the body carries the
    // transcript, the provenance the runtime filters on, and the actor the drain would have used.
    const body = JSON.stringify(recorder.requests[0]?.json);
    expect(body).toContain("the kubernetes rollout stalled");
    expect(body).toContain(DEFAULT_SETTINGS.defaultActor);
    expect(body).toContain(captureAction(chatgptAdapter.id));
    expect(body).toContain(CAPTURE_RECORD_TYPE);
    // And it left the record findable, which is the assertion that makes the rest more than a 200.
    expect(storedRecords(harness.mock).map((record) => record.recordId)).toEqual([
      "rec-delivered-1",
    ]);
    // Capture in, placed out: the off switch did not reach the capture path, and nothing was placed.
    expect(harness.mock.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
