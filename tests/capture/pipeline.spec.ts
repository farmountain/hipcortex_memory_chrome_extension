/**
 * Pipeline specs (tasks 6.6, 6.7, 6.14; G1.7, G2.10, G7.5, G8.6).
 *
 * The pipeline is the only place where the order of "validate, then send" is decided, and the order
 * is what makes the guarantee real: a validation that runs after the send cannot un-send. So the
 * central assertion here is a transport stub that recorded **zero** calls, with a positive control
 * immediately beside it proving the same stub does record a call when the event is valid.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { installChromeMock } from "../helpers/chrome-mock.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { acknowledged, createTransportStub, refused } from "../helpers/transport-stub.js";
import { makeCaptureEvent } from "../helpers/events.js";
import { parseFixture, readFixture } from "../helpers/fixtures.js";
import { expectExtractSuccess } from "../helpers/extract.js";
import { chatgptAdapter } from "../../src/capture/providers/chatgpt.js";
import { extractConversation } from "../../src/capture/extract.js";
import { isInert, runCapturePipeline } from "../../src/capture/pipeline.js";
import { QUEUE_SPILL_LIMIT, enqueueEvent, readQueue } from "../../src/capture/queue/queue.js";
import { readFailures } from "../../src/capture/failures.js";
import { recordDriftFailure, driftStatuses } from "../../src/capture/drift.js";
import { drainNow } from "../../src/capture/lifecycle.js";
import { CAPTURE_RECORD_TYPE, readCaptureProvenance } from "../../src/schema/index.js";
import type { ExtractFailure, ExtractResult, ExtractSuccess } from "../../src/capture/providers/types.js";

const CAPTURED_AT = "2025-01-15T00:00:00.000Z";
const NOW = new Date(CAPTURED_AT);
const ACTOR = "spec-actor";

function validExtraction(): ExtractSuccess {
  return expectExtractSuccess(
    extractConversation(chatgptAdapter, {
      document: parseFixture(readFixture("chatgpt", "conversation.html")),
      url: "https://chatgpt.com/c/redacted",
      title: "Redacted conversation",
      capturedAt: CAPTURED_AT,
    })
  );
}

function brokenKeyExtraction(): ExtractSuccess {
  const success = validExtraction();
  return { ...success, provenance: { ...success.provenance, capturedAt: "2025-01-15 00:00:00" } };
}

function extractionFailure(): ExtractFailure {
  return {
    ok: false,
    code: "DOM_SHAPE_UNRECOGNIZED",
    detail: "no landmark matched",
    slot: "conversationRoot",
    rung: -1,
  };
}

interface RunOptions {
  readonly result: ExtractResult;
  readonly trigger?: "passive" | "manual";
  readonly autoCapture?: boolean;
  readonly reply?: Parameters<typeof createTransportStub>[0];
}

function run(options: RunOptions) {
  const stub = createTransportStub(options.reply);
  const delivered: string[] = [];
  const outcome = runCapturePipeline(
    {
      providerId: chatgptAdapter.id,
      result: options.result,
      trigger: options.trigger ?? "manual",
    },
    {
      transport: stub.transport,
      actor: ACTOR,
      autoCapture: options.autoCapture ?? true,
      now: () => NOW,
      eventId: () => "evt-spec",
      onDelivered: async () => {
        delivered.push("drained");
      },
    }
  );
  return { outcome, stub, delivered };
}

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

describe("delivered", () => {
  it("sends one egress record carrying the capture provenance", async () => {
    const { outcome, stub, delivered } = run({ result: validExtraction() });

    await expect(outcome).resolves.toEqual({ status: "delivered", eventId: "evt-spec", recordId: "rec-1" });
    expect(stub.calls).toBe(1);

    const record = stub.records[0];
    if (!record) throw new Error("the transport recorded no capture");
    expect(record.actor).toBe(ACTOR);
    expect(record.record_type).toBe(CAPTURE_RECORD_TYPE);
    expect(readCaptureProvenance(record)?.provider).toBe(chatgptAdapter.id);

    const firstText = validExtraction().conversation.messages[0]?.text ?? "";
    expect(firstText.length).toBeGreaterThan(0);
    expect(record.target).toContain(firstText);

    // A successful send is the moment a drain is most likely to succeed (G2.6).
    expect(delivered).toEqual(["drained"]);
    expect(await readQueue()).toEqual({ entries: [], paused: false });
  });

  it("clears a provider's drift state", async () => {
    for (let index = 0; index < 3; index += 1) await recordDriftFailure({ providerId: "chatgpt", code: "NO_ROLE_SIGNAL" }, NOW);
    expect(await driftStatuses()).toHaveLength(1);

    const { outcome } = run({ result: validExtraction() });
    await expect(outcome).resolves.toMatchObject({ status: "delivered" });

    expect(await driftStatuses()).toEqual([]);
    expect(await readFailures()).toEqual([]);
  });

  it("works for a manual capture while auto capture is off", async () => {
    const { outcome, stub } = run({ result: validExtraction(), trigger: "manual", autoCapture: false });

    await expect(outcome).resolves.toMatchObject({ status: "delivered" });
    expect(stub.calls).toBe(1);
  });
});

describe("inert (G1.7)", () => {
  it("does nothing at all for a passive capture while auto capture is off", async () => {
    const stub = createTransportStub();
    const outcome = await runCapturePipeline(
      { providerId: chatgptAdapter.id, result: validExtraction(), trigger: "passive" },
      { transport: stub.transport, actor: ACTOR, autoCapture: false, now: () => NOW }
    );

    expect(outcome).toEqual({ status: "inert", reason: "auto-capture-disabled" });
    expect(stub.calls).toBe(0);
    expect(await readQueue()).toEqual({ entries: [], paused: false });
    expect(await readFailures()).toEqual([]);
    expect(await driftStatuses()).toEqual([]);
  });

  it("treats only a passive capture with the flag off as inert", () => {
    const passive = { providerId: "chatgpt", result: extractionFailure(), trigger: "passive" } as const;
    const manual = { providerId: "chatgpt", result: extractionFailure(), trigger: "manual" } as const;

    expect(isInert(passive, false)).toBe(true);
    expect(isInert(passive, true)).toBe(false);
    expect(isInert(manual, false)).toBe(false);
    expect(isInert(manual, true)).toBe(false);
  });
});

describe("rejection happens before the transport (G2.10)", () => {
  it("records a typed refusal and never offers the capture to the transport", async () => {
    const { outcome, stub } = run({ result: extractionFailure(), autoCapture: true });

    await expect(outcome).resolves.toEqual({
      status: "rejected",
      code: "DOM_SHAPE_UNRECOGNIZED",
      detail: "no landmark matched",
    });
    expect(stub.calls).toBe(0);

    const failures = await readFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ path: "validation", code: "DOM_SHAPE_UNRECOGNIZED", providerId: "chatgpt" });
    expect(failures[0]?.timestamp).toBe(CAPTURED_AT);
    expect(Object.keys(failures[0] ?? {})).toHaveLength(4);
  });

  it("counts an extraction failure towards drift", async () => {
    for (let index = 0; index < 3; index += 1) {
      const { outcome } = run({ result: extractionFailure() });
      await expect(outcome).resolves.toMatchObject({ status: "rejected" });
    }

    const statuses = await driftStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.needsAttention).toBe(true);
    expect(statuses[0]?.consecutiveFailures).toBe(3);
    expect(statuses[0]?.message).toContain("ChatGPT");
  });

  it("stops a valid extraction that the event contract refuses, and does not blame the provider", async () => {
    const { outcome, stub } = run({ result: brokenKeyExtraction() });

    await expect(outcome).resolves.toEqual({
      status: "rejected",
      code: "INVALID_TIMESTAMP",
      detail: "provenance.capturedAt: INVALID_TIMESTAMP",
    });
    expect(stub.calls).toBe(0);

    // The contract, not the page: counting this towards drift would send someone to the wrong page.
    expect(await driftStatuses()).toEqual([]);
    const failures = await readFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ path: "validation", code: "INVALID_TIMESTAMP" });
  });

  it("keeps the transcript out of the diagnostic", async () => {
    const texts = validExtraction().conversation.messages.map((message) => message.text);
    const { outcome } = run({ result: brokenKeyExtraction() });
    await expect(outcome).resolves.toMatchObject({ status: "rejected" });

    const serialised = JSON.stringify({
      outcome: await outcome,
      failures: await readFailures(),
      queue: await readQueue(),
    });
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
      expect(serialised).not.toContain(text);
    }
  });
});

describe("queued on a delivery failure", () => {
  it("enqueues the capture with the pipeline's event id and a first retry time", async () => {
    const { outcome, stub } = run({ result: validExtraction(), reply: refused("NOT_ACKNOWLEDGED") });

    await expect(outcome).resolves.toEqual({
      status: "queued",
      eventId: "evt-spec",
      reason: "NOT_ACKNOWLEDGED",
    });
    expect(stub.calls).toBe(1);

    const state = await readQueue();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.event.eventId).toBe("evt-spec");
    expect(state.entries[0]?.attempts).toBe(0);
    expect(state.entries[0]?.nextAttemptAt).toBe(new Date(NOW.getTime() + 2000).toISOString());
  });

  it("labels the failure as a transport problem, not a perception one", async () => {
    const { outcome } = run({ result: validExtraction(), reply: refused("UNREACHABLE") });
    await expect(outcome).resolves.toMatchObject({ status: "queued" });

    const failures = await readFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ path: "transport", code: "UNREACHABLE", providerId: "chatgpt" });
    expect(await driftStatuses()).toEqual([]);
  });

  it("keeps the capture when the queue is at its spill limit, reporting a pause", async () => {
    for (let index = 0; index < QUEUE_SPILL_LIMIT; index += 1) {
      await enqueueEvent(makeCaptureEvent({ eventId: `evt-${index}` }), NOW);
    }

    const { outcome } = run({ result: validExtraction(), reply: refused("UNREACHABLE") });
    const settled = await outcome;

    expect(settled.status).toBe("paused");
    if (settled.status !== "paused") throw new Error("unreachable");
    expect(settled.unacknowledged).toBe(QUEUE_SPILL_LIMIT);
    expect(settled.message).toContain(String(QUEUE_SPILL_LIMIT));
    expect(settled.message).toMatch(/paused/i);

    const state = await readQueue();
    expect(state.entries).toHaveLength(QUEUE_SPILL_LIMIT);
    expect(state.entries[0]?.event.eventId).toBe("evt-0");
  });
});

describe("toggling auto capture mid-flight strands nothing (G7.5)", () => {
  it("still delivers an already-accepted capture while new passive captures stay inert", async () => {
    const stub = createTransportStub(refused("UNREACHABLE"));

    const queued = await runCapturePipeline(
      { providerId: chatgptAdapter.id, result: validExtraction(), trigger: "passive" },
      { transport: stub.transport, actor: ACTOR, autoCapture: true, now: () => NOW, eventId: () => "evt-first" }
    );
    expect(queued).toMatchObject({ status: "queued", eventId: "evt-first" });

    // The user turns capture off. New passive observations stop, and nothing already accepted is
    // dropped: the queue drains regardless of the flag.
    const inert = await runCapturePipeline(
      { providerId: chatgptAdapter.id, result: validExtraction(), trigger: "passive" },
      { transport: stub.transport, actor: ACTOR, autoCapture: false, now: () => NOW }
    );
    expect(inert).toEqual({ status: "inert", reason: "auto-capture-disabled" });

    stub.setReply(acknowledged("rec-drain"));
    const drained = await drainNow({
      resolve: async () => ({ transport: stub.transport, actor: ACTOR }),
      // Past the entry's first retry time, which is why the drain has something to do.
      now: () => new Date(NOW.getTime() + 10_000),
    });

    expect(drained.delivered).toBe(1);
    expect(drained.unacknowledged).toBe(0);
    expect(await readQueue()).toEqual({ entries: [], paused: false });

    // The drained capture is the original one, transcript intact.
    const texts = validExtraction().conversation.messages.map((message) => message.text);
    const last = stub.records[stub.records.length - 1];
    for (const text of texts) expect(last?.target).toContain(text);
  });

  it("never moves conversation content into chrome.storage.sync", async () => {
    const { outcome } = run({ result: validExtraction(), reply: refused("UNREACHABLE") });
    await expect(outcome).resolves.toMatchObject({ status: "queued" });

    const texts = validExtraction().conversation.messages.map((message) => message.text);
    const syncValues = Object.values(mock.storage.sync.data).map((value) => JSON.stringify(value));
    for (const text of texts) expect(syncValues.join("\n")).not.toContain(text);
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
  });
});
