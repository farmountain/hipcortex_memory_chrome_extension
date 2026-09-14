/**
 * Clearing the index is non-destructive and distinct from the queue (task 3.4, G3.9).
 *
 * Two numbers have to survive the same reply, and the whole point of the case is that they are
 * different numbers: what was removed from the offline copy, and what is still held by the queue
 * waiting for the runtime. A clear that reported only the first would let a user read "cleared 12" as
 * "twelve conversations are gone" — and the one thing this layer must never do is describe a bound
 * copy of a record the core already holds as a deletion, or a queued capture as a loss.
 *
 * The other half is that the answer is local: no delete is sent anywhere, because the core owns the
 * record and the extension has no endpoint that could remove one. The runtime is stopped for every
 * case below and every route out of the worker is asserted untouched.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { INDEX_STORAGE_KEY, recordAcknowledgedCapture } from "../../src/index/local.js";
import { QUEUE_STORAGE_KEY, enqueueEvent, readQueue } from "../../src/capture/queue/queue.js";
import { makeCaptureEvent } from "../helpers/events.js";
import { makeIndexRecord, offlineWorker, storedIndex } from "../helpers/index-store.js";
import type { SearchIndexReport, SearchResult } from "../../src/types/index.js";

/** Enqueued far in the future so no drain considers it due while this spec runs. */
const NOT_YET = new Date("2035-01-01T00:00:00.000Z");

function report(call: { readonly response: { data?: unknown } }): SearchIndexReport {
  return call.response.data as SearchIndexReport;
}

function search(call: { readonly response: { data?: unknown } }): SearchResult {
  return call.response.data as SearchResult;
}

async function queueOne(text: string): Promise<void> {
  const accepted = await enqueueEvent(
    makeCaptureEvent({ eventId: "evt-queued-1", text, capturedAt: "2025-01-15T00:00:00.000Z" }),
    NOT_YET
  );
  expect(accepted.accepted).toBe(true);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clearing the index is not clearing the queue — G3.9 (task 3.4)", () => {
  it("removes every record, reports what it removed, and leaves an undelivered capture alone", async () => {
    const { worker, fetchSpy, connectSpy } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-a", recordId: "rec-a", text: "the deployment failed" }),
      makeIndexRecord({ eventId: "evt-b", recordId: "rec-b", text: "a rollback was scheduled" }),
    ]);
    await queueOne("the capture that has not been delivered yet");
    const queuedBefore = JSON.stringify(worker.mock.storage.local.data[QUEUE_STORAGE_KEY]);

    const call = await worker.send({ type: "CLEAR_SEARCH_INDEX" });

    expect(call.response.success).toBe(true);
    const data = report(call);
    expect(data.cleared).toBe(2);
    expect(data.indexed).toBe(0);
    // The second number: the capture that is *not* searchable is still here, and this is what stops
    // "cleared 2" from reading as "two conversations are gone".
    expect(data.unacknowledged).toBe(1);

    // The undelivered capture is untouched — byte for byte, so a rewrite that happened to preserve
    // the count would still fail this.
    expect((await readQueue()).entries).toHaveLength(1);
    expect(JSON.stringify(worker.mock.storage.local.data[QUEUE_STORAGE_KEY])).toBe(queuedBefore);

    // And the offline copy is gone, both from storage and from the answer the search path gives.
    expect(storedIndex(worker.mock)).toBeUndefined();
    const after = await worker.send({ type: "SEARCH_MEMORY", query: "deployment" });
    expect(search(after).count).toBe(0);
    expect(search(after).indexed).toBe(0);
    expect(search(after).source).toBe("local");

    // Nothing was deleted anywhere else: clearing the copy is a local action.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("is a success that removed nothing when the index is already empty", async () => {
    const { worker } = await offlineWorker();

    const first = await worker.send({ type: "CLEAR_SEARCH_INDEX" });
    expect(first.response.success).toBe(true);
    expect(report(first)).toEqual({ cleared: 0, indexed: 0, unacknowledged: 0 });

    // Clearing twice is not an error either: the second clear finds nothing and says so.
    const second = await worker.send({ type: "CLEAR_SEARCH_INDEX" });
    expect(second.response.success).toBe(true);
    expect(report(second).cleared).toBe(0);
  });

  it("does not stop a later acknowledgement from being searchable", async () => {
    const { worker } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-a", recordId: "rec-a", text: "an old capture" }),
    ]);

    await worker.send({ type: "CLEAR_SEARCH_INDEX" });
    await recordAcknowledgedCapture(
      makeCaptureEvent({
        eventId: "evt-new",
        text: "a capture acknowledged after the clear",
        capturedAt: "2025-02-01T00:00:00.000Z",
      }),
      "rec-new",
      "spec-actor"
    );

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "acknowledged after" });
    expect(search(call).count).toBe(1);
    expect(search(call).results[0]?.id).toBe("rec-new");

    // The cleared record stays cleared: this is a clear of what *was* held, not a filter over future
    // writes, and a stale copy must not come back through a later acknowledgement of another capture.
    const stale = await worker.send({ type: "SEARCH_MEMORY", query: "old capture" });
    expect(search(stale).count).toBe(0);
    expect(search(stale).indexed).toBe(1);
  });

  it("reports the same unacknowledged count the status surface reads", async () => {
    const { worker } = await offlineWorker([makeIndexRecord({ text: "an indexed capture" })]);
    await queueOne("first undelivered capture");
    await enqueueEvent(
      makeCaptureEvent({ eventId: "evt-queued-2", text: "second undelivered capture" }),
      NOT_YET
    );

    const status = await worker.send({ type: "CAPTURE_STATUS" });
    const held = (status.response.data as { retention: { queued: number; retrying: number; refused: number } })
      .retention;

    const call = await worker.send({ type: "CLEAR_SEARCH_INDEX" });

    expect(report(call).unacknowledged).toBe(held.queued + held.retrying + held.refused);
    // Two captures are still the extension's responsibility after the clear, and neither is
    // findable — the count and the search path describe the same pair of facts.
    expect(report(call).unacknowledged).toBe(2);
    const after = await worker.send({ type: "SEARCH_MEMORY", query: "undelivered" });
    expect(search(after).count).toBe(0);
    expect(search(after).indexed).toBe(0);
  });

  it("leaves the stored value absent rather than writing an empty list", async () => {
    const { worker } = await offlineWorker([makeIndexRecord({ text: "an indexed capture" })]);
    expect(storedIndex(worker.mock)).toBeDefined();

    await worker.send({ type: "CLEAR_SEARCH_INDEX" });

    // `remove` rather than `set { records: [] }`: an empty list is a claim about the index, and the
    // honest state after a clear is that there is no index here.
    expect(Object.hasOwn(worker.mock.storage.local.data, INDEX_STORAGE_KEY)).toBe(false);
  });
});
