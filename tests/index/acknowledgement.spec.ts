/**
 * Only an acknowledged capture is searchable (task 3.3, G2.1, G3.9).
 *
 * The index is a **copy** of what the core already holds, so the only moment it may be written is the
 * moment the runtime has confirmed the record exists. Two seams see that moment — the pipeline's
 * direct delivery and the queue drain — and this spec drives both, because a rule that only holds at
 * one of them holds at neither.
 *
 * The other half is the negative: a capture that is merely retained (queued, refused, paused) is not
 * searchable, an unreadable identity is refused rather than indexed, and a perception the extractor
 * rejected never reaches the index at all. Without those, "indexed on acknowledgement" would be
 * satisfied by an index that records everything and happens to be right.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { installChromeMock } from "../helpers/chrome-mock.js";
import { acknowledged, createTransportStub, refused } from "../helpers/transport-stub.js";
import { makeCaptureEvent } from "../helpers/events.js";
import { chatgptAdapter } from "../../src/capture/providers/chatgpt.js";
import { runCapturePipeline } from "../../src/capture/pipeline.js";
import { BASE_BACKOFF_MS, enqueueEvent, readQueue } from "../../src/capture/queue/queue.js";
import { drainNow } from "../../src/capture/lifecycle.js";
import { indexSize, readIndex, recordAcknowledgedCapture, searchIndex } from "../../src/index/local.js";
import { SCHEMA_VERSION } from "../../src/schema/version.js";
import { CAPTURE_SOURCE } from "../../src/schema/egress.js";
import type { ExtractFailure, ExtractSuccess } from "../../src/capture/providers/types.js";

const CAPTURED_AT = "2025-01-15T00:00:00.000Z";
const NOW = new Date(CAPTURED_AT);
// An entry is due one backoff step after it was queued, so this is the first instant a drain can
// attempt it. Taken from the queue's own constant rather than a literal, so the reason is visible.
const DUE = new Date(NOW.getTime() + BASE_BACKOFF_MS);
const ACTOR = "spec-actor";
const CONVERSATION_URL = "https://chatgpt.com/c/redacted";

beforeEach(() => {
  installChromeMock();
});

function queuedEvent(eventId = "evt-queued-1") {
  return makeCaptureEvent({
    eventId,
    text: "the kubernetes rollout stalled",
    capturedAt: CAPTURED_AT,
  });
}

/**
 * A two-message conversation built by hand. This spec is about the index, not about a provider's DOM,
 * so it declares the extraction instead of reading a fixture — and it names the real contract
 * constants, so a change to the schema breaks this loudly rather than silently.
 */
function validExtraction(): ExtractSuccess {
  return {
    ok: true,
    conversation: {
      url: CONVERSATION_URL,
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
      conversationUrl: CONVERSATION_URL,
      capturedAt: CAPTURED_AT,
    },
    rungs: { conversationRoot: 0, turnContainer: 0, messageText: 0, roleSignal: 0 },
  };
}

describe("an unacknowledged capture is not searchable — G2.1, G3.9 (task 3.3)", () => {
  it("becomes searchable at the drain that acknowledged it, and not before", async () => {
    const event = queuedEvent();
    const enqueued = await enqueueEvent(event, NOW);
    expect(enqueued.accepted).toBe(true);
    expect((await readQueue()).entries).toHaveLength(1);

    // Retained, and deliberately not findable: the core has not got it yet, so offering it as a
    // memory would be offering something that may still be lost.
    const before = await searchIndex({ text: "kubernetes" });
    expect(before.hits).toEqual([]);
    expect(before.indexed).toBe(0);
    expect(await readIndex()).toEqual([]);

    const stub = createTransportStub(acknowledged("rec-drain-1"));
    const outcome = await drainNow({
      resolve: async () => ({ transport: stub.transport, actor: ACTOR }),
      now: () => DUE,
    });

    expect(stub.calls).toBe(1);
    expect(outcome.delivered).toBe(1);
    expect((await readQueue()).entries).toEqual([]);

    const after = await searchIndex({ text: "kubernetes" });
    expect(after.indexed).toBe(1);
    expect(after.hits).toHaveLength(1);
    expect(after.hits[0]?.record.recordId).toBe("rec-drain-1");
    expect(after.hits[0]?.record.actor).toBe(ACTOR);
    expect(after.hits[0]?.record.capturedAt).toBe(CAPTURED_AT);
  });

  it("becomes searchable at the direct delivery, which is the other seam", async () => {
    const stub = createTransportStub(acknowledged("rec-1"));
    const outcome = await runCapturePipeline(
      { providerId: chatgptAdapter.id, result: validExtraction(), trigger: "manual" },
      {
        transport: stub.transport,
        actor: ACTOR,
        autoCapture: true,
        now: () => NOW,
        eventId: () => "evt-direct-1",
      }
    );

    expect(outcome.status).toBe("delivered");
    const records = await readIndex();
    expect(records).toHaveLength(1);
    expect(records[0]?.recordId).toBe("rec-1");
    expect(records[0]?.eventId).toBe("evt-direct-1");
    expect(records[0]?.provider).toBe("chatgpt");
    expect(records[0]?.conversationUrl).toBe(CONVERSATION_URL);
    expect(records[0]?.capturedAt).toBe(CAPTURED_AT);
    expect(records[0]?.text.length).toBeGreaterThan(0);
    expect(records[0]?.tokens.length).toBeGreaterThan(0);

    // The record the seam wrote is the record a query reads: asking for one of its own tokens finds
    // it, so the two halves of the seam are connected rather than merely both present.
    const token = records[0]?.tokens[0] ?? "";
    const found = await searchIndex({ text: token });
    expect(found.hits.map((hit) => hit.record.recordId)).toEqual(["rec-1"]);
  });

  it("stays unsearchable when the runtime refused the send", async () => {
    const stub = createTransportStub(refused("UNREACHABLE"));
    const outcome = await runCapturePipeline(
      { providerId: chatgptAdapter.id, result: validExtraction(), trigger: "manual" },
      {
        transport: stub.transport,
        actor: ACTOR,
        autoCapture: true,
        now: () => NOW,
        eventId: () => "evt-refused-1",
      }
    );

    expect(outcome.status).toBe("queued");
    expect((await readQueue()).entries).toHaveLength(1);
    expect(await readIndex()).toEqual([]);
    expect((await searchIndex({ text: "the" })).indexed).toBe(0);
  });

  it("never indexes a perception the extractor refused", async () => {
    const failure: ExtractFailure = {
      ok: false,
      code: "DOM_SHAPE_UNRECOGNIZED",
      detail: "no conversation landmark matched",
      slot: "conversationRoot",
      rung: -1,
    };
    const stub = createTransportStub(acknowledged("rec-none"));

    const outcome = await runCapturePipeline(
      { providerId: chatgptAdapter.id, result: failure, trigger: "manual" },
      {
        transport: stub.transport,
        actor: ACTOR,
        autoCapture: true,
        now: () => NOW,
        eventId: () => "evt-rejected-1",
      }
    );

    expect(outcome.status).toBe("rejected");
    expect(stub.calls).toBe(0);
    expect(await readIndex()).toEqual([]);
  });

  it("refuses an empty record id rather than recording the capture against nothing", async () => {
    const result = await recordAcknowledgedCapture(queuedEvent(), "", ACTOR);

    // Not an error — the write is a cache and a refusal is not a failure — but not a record either.
    expect(result.failed).toBe(false);
    expect(result.evicted).toBe(0);
    expect(await readIndex()).toEqual([]);
    expect(await indexSize()).toBe(0);
  });

  it("keeps one record per capture attempt, so a second acknowledgement does not duplicate a hit", async () => {
    const event = queuedEvent();

    await recordAcknowledgedCapture(event, "rec-first", ACTOR);
    await recordAcknowledgedCapture(event, "rec-second", ACTOR);

    const records = await readIndex();
    expect(records).toHaveLength(1);
    expect(records[0]?.recordId).toBe("rec-second");

    // A different attempt is a different record: the event id identifies the attempt, not the
    // conversation, so this must not collapse to one.
    await recordAcknowledgedCapture(queuedEvent("evt-queued-2"), "rec-third", ACTOR);
    expect(await indexSize()).toBe(2);
  });

  it("reports an acknowledgement that could not be written instead of failing the capture", async () => {
    const event = queuedEvent();
    const original = globalThis.chrome.storage.local.set;
    globalThis.chrome.storage.local.set = async () => {
      throw new Error("storage is unavailable");
    };

    try {
      const result = await recordAcknowledgedCapture(event, "rec-1", ACTOR);

      // The capture is already acknowledged by this point. A cache that can fail a delivery is a
      // cache that has become load-bearing, so this must be reported and swallowed.
      expect(result.failed).toBe(true);
      expect(result.indexed).toBe(0);
    } finally {
      globalThis.chrome.storage.local.set = original;
    }
  });
});
