/**
 * Queue specs (tasks 6.3, 6.4, 6.5 and 6.9) — the retention boundary's rules.
 *
 * Every test here is written against a *falsifiable* claim, because the interesting failure mode is
 * not "the queue is slow", it is "the queue quietly threw a conversation away". So the assertions are
 * about absence: nothing is evicted at the spill limit, no loss counter exists (asserted against the
 * persisted value, not just the API), nothing removes an entry except an acknowledgement, and no
 * conversation text reaches `chrome.storage.sync`.
 *
 * `chrome.storage.local` is backed by an in-memory object on the mock, so the assertions read what
 * was *persisted* rather than what was passed to `set`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installChromeMock } from "../helpers/chrome-mock.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { installFetchMock, jsonBody } from "../helpers/http.js";
import { makeCaptureEvent, textsOf } from "../helpers/events.js";
import {
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  QUEUE_SPILL_LIMIT,
  QUEUE_STORAGE_KEY,
  backoffDelayMs,
  drainQueue,
  dueEntries,
  enqueueEvent,
  markAttempt,
  pauseMessage,
  readQueue,
  removeAcknowledged,
  writeQueue,
} from "../../src/capture/queue/queue.js";
import { exportQueue } from "../../src/capture/queue/export.js";
import { HttpTransport } from "../../src/api/transport/http.js";
import { toEgressRecord } from "../../src/schema/index.js";
import type { CaptureEvent } from "../../src/schema/index.js";
import type { SendFailureKind, SendFailureReason, SendResult } from "../../src/api/transport/index.js";
import * as queueModule from "../../src/capture/queue/queue.js";

const T0 = new Date("2025-01-15T00:00:00.000Z");

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

function acknowledged(recordId: string): SendResult {
  return { acknowledged: true, transport: "http", recordId, warning: [] };
}

/**
 * A failed send.
 *
 * `kind` defaults to `transient` because that is what most specs here exercise, and a spec that is
 * actually about a refusal passes it explicitly — so the default can never quietly make a refusal
 * spec pass for the wrong reason.
 */
function refused(
  reason: SendFailureReason,
  failure: { readonly kind?: SendFailureKind; readonly refusalReason?: string } = {}
): SendResult {
  return {
    acknowledged: false,
    transport: "http",
    reason,
    detail: "spec",
    kind: failure.kind ?? "transient",
    refusalReason: failure.refusalReason ?? null,
  };
}

/** The persisted queue, read straight out of the storage mock rather than through `readQueue`. */
function persisted(mock: ChromeMock): Record<string, unknown> {
  return mock.storage.local.data[QUEUE_STORAGE_KEY] as Record<string, unknown>;
}

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("enqueue", () => {
  it("appends to the tail with a fresh attempt count and a persisted retry time", async () => {
    const first = makeCaptureEvent({ eventId: "evt-1", text: "first" });
    const second = makeCaptureEvent({ eventId: "evt-2", text: "second" });

    await enqueueEvent(first, T0);
    await enqueueEvent(second, T0);

    const state = await readQueue();
    expect(state.entries.map((entry) => entry.event.eventId)).toEqual(["evt-1", "evt-2"]);
    expect(state.entries[0]?.attempts).toBe(0);
    expect(state.paused).toBe(false);

    // Due after one backoff step: the send that produced this entry has just failed.
    expect(state.entries[0]?.enqueuedAt).toBe(T0.toISOString());
    expect(state.entries[0]?.nextAttemptAt).toBe(at(BASE_BACKOFF_MS).toISOString());

    const stored = persisted(mock);
    const entries = stored["entries"] as { nextAttemptAt: string }[];
    expect(entries[0]?.nextAttemptAt).toBe(at(BASE_BACKOFF_MS).toISOString());
  });

  it("keeps the conversation in the entry it stores", async () => {
    const event = makeCaptureEvent({ eventId: "evt-1", text: "keep me", messages: 4 });
    await enqueueEvent(event, T0);

    const state = await readQueue();
    expect(state.entries[0]?.event).toEqual(event);
    expect(state.entries[0]?.event.conversation.messages).toHaveLength(4);
  });

  it("never writes conversation content to chrome.storage.sync", async () => {
    const event = makeCaptureEvent({ eventId: "evt-1", text: "private transcript line" });
    await enqueueEvent(event, T0);

    const syncValues = Object.values(mock.storage.sync.data).map((value) => JSON.stringify(value));
    expect(syncValues.join("\n")).not.toContain("private transcript line");
    expect(Object.keys(mock.storage.sync.data)).not.toContain(QUEUE_STORAGE_KEY);
    expect(mock.storage.sync.set).not.toHaveBeenCalled();
  });
});

describe("read", () => {
  it("does not write, so reading the queue can never discard an entry", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), T0);
    mock.storage.local.set.mockClear();

    const state = await readQueue();

    expect(state.entries).toHaveLength(1);
    expect(mock.storage.local.set).not.toHaveBeenCalled();
  });

  it("ignores an entry the event contract rejects instead of throwing", async () => {
    mock.storage.local.data[QUEUE_STORAGE_KEY] = {
      entries: [{ event: { eventId: "broken" }, attempts: 0, enqueuedAt: "x", nextAttemptAt: "y" }],
      paused: true,
    };

    await expect(readQueue()).resolves.toEqual({ entries: [], paused: false });
  });
});

describe("acknowledgement is the only removal (G2.1)", () => {
  beforeEach(async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1", text: "one" }), T0);
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-2", text: "two" }), T0);
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-3", text: "three" }), T0);
  });

  it("removes only the acknowledged entry and leaves FIFO order intact", async () => {
    const outcome = await drainQueue({
      send: async (event) => (event.eventId === "evt-2" ? acknowledged("rec-2") : refused("NOT_ACKNOWLEDGED")),
      now: () => at(10_000),
    });

    expect(outcome.attempted).toBe(3);
    expect(outcome.delivered).toBe(1);
    expect(outcome.unacknowledged).toBe(2);

    const state = await readQueue();
    expect(state.entries.map((entry) => entry.event.eventId)).toEqual(["evt-1", "evt-3"]);
  });

  it("exposes no second way to shrink the queue", () => {
    // Inspected on the module namespace, not on a list written next to the assertion: a future
    // `clearQueue`/`evict` helper would be a code path that discards an unacknowledged capture,
    // which G2.2 forbids outright.
    const shrinking = Object.keys(queueModule).filter((name) =>
      /clear|evict|drop|discard|trim|prune|reset|flush|purge/i.test(name)
    );
    expect(shrinking).toEqual([]);

    const removers = Object.keys(queueModule).filter((name) => /remov|delete/i.test(name));
    expect(removers).toEqual(["removeAcknowledged"]);
  });

  it("retains an entry whose 2xx reply carried no record_id (G2.9)", async () => {
    const recorder = installFetchMock(() => jsonBody({ status: "ok" }));
    const transport = new HttpTransport("http://127.0.0.1:3030", "", "developer");

    const outcome = await drainQueue({
      send: (event) => transport.addMemory(toEgressRecord(event, "spec-actor")),
      now: () => at(10_000),
    });

    expect(recorder.requests).toHaveLength(3);
    expect(recorder.requests[0]?.url).toContain("/memory/add");
    expect(outcome.delivered).toBe(0);

    const state = await readQueue();
    expect(state.entries.map((entry) => entry.event.eventId)).toEqual(["evt-1", "evt-2", "evt-3"]);
    for (const entry of state.entries) expect(entry.attempts).toBe(1);
  });

  it("retains every entry when the runtime is unreachable", async () => {
    installFetchMock(() => ({ networkError: "connect ECONNREFUSED" }));
    const transport = new HttpTransport("http://127.0.0.1:3030", "", "developer");

    const outcome = await drainQueue({
      send: (event) => transport.addMemory(toEgressRecord(event, "spec-actor")),
      now: () => at(10_000),
    });

    expect(outcome.delivered).toBe(0);
    expect(outcome.unacknowledged).toBe(3);
    expect((await readQueue()).entries).toHaveLength(3);
  });
});

describe("the spill limit is a pause, never a discard (G2.2, G2.3)", () => {
  async function fillToLimit(): Promise<void> {
    for (let index = 0; index < QUEUE_SPILL_LIMIT; index += 1) {
      await enqueueEvent(makeCaptureEvent({ eventId: `evt-${index}`, text: `line ${index}` }), T0);
    }
  }

  it("keeps every entry at the limit and reports paused", async () => {
    await fillToLimit();

    const state = await readQueue();
    expect(state.entries).toHaveLength(QUEUE_SPILL_LIMIT);
    expect(state.paused).toBe(true);
    expect(state.entries[0]?.event.eventId).toBe("evt-0");
    expect(state.entries[QUEUE_SPILL_LIMIT - 1]?.event.eventId).toBe(`evt-${QUEUE_SPILL_LIMIT - 1}`);
  });

  it("refuses a new capture with a message naming the unacknowledged count", async () => {
    await fillToLimit();

    const result = await enqueueEvent(makeCaptureEvent({ eventId: "evt-overflow" }), T0);

    expect(result.accepted).toBe(false);
    expect(result.message).toBe(pauseMessage(QUEUE_SPILL_LIMIT));
    expect(result.message).toContain(String(QUEUE_SPILL_LIMIT));
    expect(result.message).toMatch(/paused/i);
    expect(result.message).not.toMatch(/\blost\b/i);
    expect((await readQueue()).entries).toHaveLength(QUEUE_SPILL_LIMIT);
  });

  it("persists no loss counter of any name", async () => {
    await fillToLimit();

    const stored = persisted(mock);
    expect(Object.keys(stored).sort()).toEqual(["entries", "paused"]);

    const serialised = JSON.stringify(stored);
    for (const forbidden of ["lost", "dropped", "discarded", "evicted", "truncated"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("resumes accepting once the queue drains below the limit", async () => {
    await fillToLimit();

    await drainQueue({
      send: async () => acknowledged("rec"),
      now: () => at(10_000),
      batchLimit: QUEUE_SPILL_LIMIT,
    });

    const state = await readQueue();
    expect(state.entries).toHaveLength(0);
    expect(state.paused).toBe(false);
    await expect(enqueueEvent(makeCaptureEvent({ eventId: "evt-after" }), T0)).resolves.toMatchObject({
      accepted: true,
    });
  });
});

describe("backoff (G2.5)", () => {
  it("doubles from two seconds and caps at five minutes", () => {
    expect(backoffDelayMs(0)).toBe(2000);
    expect(backoffDelayMs(1)).toBe(4000);
    expect(backoffDelayMs(2)).toBe(8000);
    expect(backoffDelayMs(3)).toBe(16000);
    expect(backoffDelayMs(7)).toBe(256000);
    expect(backoffDelayMs(8)).toBe(MAX_BACKOFF_MS);
    expect(backoffDelayMs(64)).toBe(MAX_BACKOFF_MS);
    expect(backoffDelayMs(1000)).toBe(MAX_BACKOFF_MS);
    expect(MAX_BACKOFF_MS).toBe(300000);
  });

  it("never decreases as attempts accumulate", () => {
    let previous = -1;
    for (let attempts = 0; attempts <= 40; attempts += 1) {
      const delay = backoffDelayMs(attempts);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
    expect(previous).toBe(MAX_BACKOFF_MS);
  });

  it("moves nextAttemptAt forward by the backoff for the attempts now made", () => {
    const entry = {
      event: makeCaptureEvent({ eventId: "evt-1" }),
      attempts: 0,
      enqueuedAt: T0.toISOString(),
      nextAttemptAt: at(BASE_BACKOFF_MS).toISOString(),
      outcome: "pending" as const,
      refusalReason: null,
    };

    const interrupted = { reason: "UNREACHABLE" as const, kind: "transient" as const, refusalReason: null };
    const first = markAttempt(entry, interrupted, T0);
    expect(first.attempts).toBe(1);
    expect(first.nextAttemptAt).toBe(at(4000).toISOString());

    const second = markAttempt(first, interrupted, T0);
    expect(second.attempts).toBe(2);
    expect(second.nextAttemptAt).toBe(at(8000).toISOString());
  });

  it("keeps an entry out of the due set until its retry time arrives", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), T0);
    const state = await readQueue();

    expect(dueEntries(state, at(1999))).toHaveLength(0);
    expect(dueEntries(state, at(2000))).toHaveLength(1);
    expect(dueEntries(state, at(60_000))).toHaveLength(1);
  });
});

describe("drain order survives a restart (G2.4)", () => {
  it("reads FIFO order out of storage, not out of memory", async () => {
    for (const id of ["evt-a", "evt-b", "evt-c"]) {
      await enqueueEvent(makeCaptureEvent({ eventId: id, text: id }), T0);
    }

    // A restart is exactly this: nothing in this module is stateful, so a fresh drain must derive
    // its order from what was persisted.
    const before = await dueEntries(await readQueue(), at(10_000));
    expect(before.map((entry) => entry.event.eventId)).toEqual(["evt-a", "evt-b", "evt-c"]);

    const seen: string[] = [];
    await writeQueue({ entries: before, paused: false });

    const outcome = await drainQueue({
      send: async (event: CaptureEvent) => {
        seen.push(event.eventId);
        return acknowledged(`rec-${event.eventId}`);
      },
      now: () => at(10_000),
    });

    expect(seen).toEqual(["evt-a", "evt-b", "evt-c"]);
    expect(outcome.delivered).toBe(3);
    expect((await readQueue()).entries).toHaveLength(0);
  });

  it("lets a failed entry be retried after the acknowledged ones are gone", async () => {
    for (const id of ["evt-a", "evt-b"]) {
      await enqueueEvent(makeCaptureEvent({ eventId: id, text: id }), T0);
    }

    await drainQueue({
      send: async (event) => (event.eventId === "evt-a" ? refused("UNREACHABLE") : acknowledged("rec-b")),
      now: () => at(10_000),
    });

    const state = await readQueue();
    expect(state.entries.map((entry) => entry.event.eventId)).toEqual(["evt-a"]);
    // Attempted once at 10s, so it waits 4s (attempts = 1) before it is due again.
    expect(state.entries[0]?.attempts).toBe(1);
    expect(dueEntries(state, at(13_999))).toHaveLength(0);
    expect(dueEntries(state, at(14_000))).toHaveLength(1);
  });
});

describe("drain cost and honesty", () => {
  it("does not attempt more than the batch limit in one pass", async () => {
    for (let index = 0; index < 12; index += 1) {
      await enqueueEvent(makeCaptureEvent({ eventId: `evt-${index}` }), T0);
    }

    const outcome = await drainQueue({
      send: async () => refused("UNREACHABLE"),
      now: () => at(10_000),
      batchLimit: 5,
    });

    expect(outcome.attempted).toBe(5);
    expect((await readQueue()).entries).toHaveLength(12);
  });

  it("keeps draining past an entry the transport refuses, so one poison entry cannot stall the rest", async () => {
    for (const id of ["evt-a", "evt-b", "evt-c"]) {
      await enqueueEvent(makeCaptureEvent({ eventId: id }), T0);
    }

    const seen: string[] = [];
    const outcome = await drainQueue({
      send: async (event) => {
        seen.push(event.eventId);
        if (event.eventId === "evt-a") throw new Error("transport threw");
        return acknowledged("rec");
      },
      now: () => at(10_000),
    });

    expect(seen).toEqual(["evt-a", "evt-b", "evt-c"]);
    expect(outcome.delivered).toBe(2);
    expect(outcome.outcomes.map((record) => record.reason)).toEqual(["UNREACHABLE"]);
    // The one entry that survived was interrupted, not refused: nothing judged the record.
    expect(outcome.retention).toMatchObject({ queued: 1, retrying: 1, refused: 0, refusals: [] });
    expect((await readQueue()).entries.map((entry) => entry.event.eventId)).toEqual(["evt-a"]);
  });

  it("reports the paused message from a drain when the backlog is at the limit", async () => {
    for (let index = 0; index < QUEUE_SPILL_LIMIT; index += 1) {
      await enqueueEvent(makeCaptureEvent({ eventId: `evt-${index}` }), T0);
    }

    const outcome = await drainQueue({
      send: async () => refused("UNREACHABLE"),
      now: () => at(10_000),
      batchLimit: 1,
    });

    expect(outcome.paused).toBe(true);
    expect(outcome.message).toBe(pauseMessage(QUEUE_SPILL_LIMIT));
  });

  it("removes nothing when the runtime answers 2xx without a record_id — G2.1 (task 2.2)", async () => {
    // The transport reads that reply as `NOT_ACKNOWLEDGED`: the request succeeded and the runtime
    // still did not confirm the record. A 2xx is not an acknowledgement, so an entry whose send
    // produced one is retried and stays counted — both as queued and as unacknowledged.
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), T0);
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-2" }), T0);

    const outcome = await drainQueue({
      send: async () => refused("NOT_ACKNOWLEDGED"),
      now: () => at(10_000),
    });

    expect(outcome.delivered).toBe(0);
    expect(outcome.outcomes.map((record) => record.reason)).toEqual([
      "NOT_ACKNOWLEDGED",
      "NOT_ACKNOWLEDGED",
    ]);
    expect(outcome.retention).toMatchObject({ queued: 2, retrying: 2, refused: 0, refusals: [] });
    expect((await readQueue()).entries.map((entry) => entry.event.eventId)).toEqual(["evt-1", "evt-2"]);
  });

  it("does nothing when no entry is due", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), T0);
    const send = vi.fn(async () => acknowledged("rec"));

    const outcome = await drainQueue({ send, now: () => at(0) });

    expect(send).not.toHaveBeenCalled();
    expect(outcome.attempted).toBe(0);
    expect(outcome.unacknowledged).toBe(1);
  });
});

describe("nothing is skipped by a setting", () => {
  it("drains a queue that was filled while auto capture was on, with the flag off", async () => {
    // The queue has no `autoCapture` parameter at all — this test exists so that adding one is a
    // failing change rather than a silent way to strand accepted captures (G7.5).
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1", text: "accepted earlier" }), T0);
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-2", text: "accepted earlier too" }), T0);

    const seen: string[] = [];
    const outcome = await drainQueue({
      send: async (event) => {
        seen.push(event.conversation.messages[0]?.text ?? "");
        return acknowledged("rec");
      },
      now: () => at(10_000),
    });

    expect(seen).toEqual(["accepted earlier", "accepted earlier too"]);
    expect(outcome.delivered).toBe(2);
  });
});

/**
 * Task 5.3 — a refusal is a state a capture is *in*, not a verdict that ends it (G2.2).
 *
 * `refused` is a real value in the queue, and the risk that comes with naming a state is treating it
 * as a terminal one: an implementation that moves a refused entry out of the due set, quarantines it
 * or stops exporting it would still pass every other spec here. So these two tests are about the
 * capture surviving its own refusal — exportable while refused, and delivered with no state to clear
 * once the runtime stops refusing. The reason is used verbatim from the live runtime (recorded in
 * `docs/END-STATE.md`), because the refusal this extension has to survive is a real one.
 */
describe("a refusal is a state, not an ending — G2.2 (task 5.3)", () => {
  const REASON = 'precondition blocked: PII risk=0.90 patterns=["PII:1789363055"]';
  const TEXT = "a conversation the runtime refused";

  it("keeps a refused capture in the queue and exportable while it is refused", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-refused", text: TEXT }), T0);

    const outcome = await drainQueue({
      send: async () => refused("HTTP_ERROR", { kind: "refused", refusalReason: REASON }),
      now: () => at(10_000),
    });

    expect(outcome.delivered).toBe(0);
    expect(outcome.retention).toMatchObject({ queued: 1, refused: 1, retrying: 0 });
    expect(outcome.retention.refusals).toMatchObject([{ eventId: "evt-refused", reason: REASON }]);

    const exported = await exportQueue("spec-actor", "2025-01-15T00:00:10.000Z");
    expect(exported.total).toBe(1);
    expect(exported.records[0]?.target).toContain(TEXT);
    expect((await readQueue()).entries).toHaveLength(1);
  });

  it("delivers the same capture once the runtime accepts it, with no state to clear first", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-refused", text: TEXT }), T0);
    await drainQueue({
      send: async () => refused("HTTP_ERROR", { kind: "refused", refusalReason: REASON }),
      now: () => at(10_000),
    });

    const delivered: string[] = [];
    const second = await drainQueue({
      send: async (event) => {
        delivered.push(event.eventId);
        return acknowledged("rec-refused-then-accepted");
      },
      now: () => at(600_000),
    });

    // The entry was still due, unmodified, and left the queue on an acknowledgement — the refusal did
    // not have to be withdrawn, and there is no `clearRefusal` step for a caller to forget.
    expect(delivered).toEqual(["evt-refused"]);
    expect(second.delivered).toBe(1);
    expect(second.retention).toMatchObject({ queued: 0, refused: 0, retrying: 0, refusals: [] });
    expect((await readQueue()).entries).toEqual([]);
  });
});

describe("helper sanity", () => {
  it("rejects a non-capture event so the queue specs cannot pass on garbage", async () => {
    const event = makeCaptureEvent({ eventId: "evt-1", text: "a line of transcript" });
    expect(textsOf(event)).toContain("a line of transcript");
    await expect(enqueueEvent(event, T0)).resolves.toMatchObject({ accepted: true });
  });

  it("leaves the queue untouched when nothing is acknowledged", () => {
    const entries = [
      {
        event: makeCaptureEvent({ eventId: "evt-1" }),
        attempts: 0,
        enqueuedAt: T0.toISOString(),
        nextAttemptAt: T0.toISOString(),
        outcome: "pending" as const,
        refusalReason: null,
      },
    ];
    expect(removeAcknowledged({ entries, paused: false }, [])).toEqual({ entries, paused: false });
    expect(removeAcknowledged({ entries, paused: false }, ["evt-2"]).entries).toHaveLength(1);
    expect(removeAcknowledged({ entries, paused: false }, ["evt-1"]).entries).toHaveLength(0);
  });
});
