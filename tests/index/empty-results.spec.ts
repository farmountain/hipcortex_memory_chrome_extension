/**
 * An empty result is a success, not an error (task 3.2, G3.9).
 *
 * The failure this pins down is the tempting one: a search that finds nothing is easy to report as
 * `success: false` — "no results" reads like a bad query, and a surface is already written to render
 * an error string. Every case below therefore asserts `success: true` *and* the reported state
 * (`count`, `indexed`, `unmatchedTokens`) that lets a surface say which kind of nothing happened: no
 * captures here yet, nothing matched, or a query too short to search for.
 *
 * Every case also runs with the runtime stopped, because "empty" must be answered from the index —
 * if the worker asked the runtime and reported its refusal as an empty success, a user would read a
 * stopped runtime as an empty history.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { INDEX_STORAGE_KEY } from "../../src/index/local.js";
import { makeIndexRecord, offlineWorker, storedIndex } from "../helpers/index-store.js";
import type { IndexRecord } from "../../src/index/record.js";
import type { SearchIndexStatus, SearchResult } from "../../src/types/index.js";

function found(call: { readonly response: { data?: unknown } }): SearchResult {
  return call.response.data as SearchResult;
}

/** Many records that all answer to the same token, for the bound and default-limit cases. */
function many(count: number, text: string): IndexRecord[] {
  return Array.from({ length: count }, (_unused, index) =>
    makeIndexRecord({
      eventId: `evt-${index}`,
      recordId: `rec-${index}`,
      capturedAt: `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      text,
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an empty result is a success — G3.9 (task 3.2)", () => {
  it("answers a first query with a success that names an empty local index", async () => {
    const { worker, fetchSpy, connectSpy } = await offlineWorker();

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "anything at all" });

    expect(call.response.success).toBe(true);
    expect(call.response.error).toBeUndefined();
    const data = found(call);
    expect(data.results).toEqual([]);
    expect(data.count).toBe(0);
    expect(data.source).toBe("local");
    // The number a surface needs to distinguish "nothing captured yet" from "nothing matched".
    expect(data.indexed).toBe(0);
    // With nothing held, every token went unmatched — which is the honest report, and the one a
    // surface turns into "No captures here yet" rather than "no matches for anything at all".
    expect(data.unmatchedTokens).toEqual(["anything", "at", "all"]);
    // Only the runtime's own search can report a limitation; an empty local answer has nothing to
    // excuse.
    expect(data.limitation).toBeUndefined();

    expect(connectSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers a query that matches nothing with the size of what it searched", async () => {
    const { worker, fetchSpy } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-a", recordId: "rec-a", text: "the deployment failed" }),
      makeIndexRecord({ eventId: "evt-b", recordId: "rec-b", text: "a rollback was scheduled" }),
    ]);

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "kubernetes" });

    expect(call.response.success).toBe(true);
    const data = found(call);
    expect(data.results).toEqual([]);
    expect(data.count).toBe(0);
    expect(data.indexed).toBe(2);
    expect(data.unmatchedTokens).toEqual(["kubernetes"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not turn a too-short query into a match on everything", async () => {
    const { worker } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-a", recordId: "rec-a", text: "ab cd" }),
    ]);

    const short = await worker.send({ type: "SEARCH_MEMORY", query: "c" });

    expect(short.response.success).toBe(true);
    expect(found(short).count).toBe(0);
    expect(found(short).indexed).toBe(1);
    // The record is there and is findable by a token of searchable length, which is what makes the
    // empty answer above a statement about the minimum token length rather than a missing capture.
    const real = await worker.send({ type: "SEARCH_MEMORY", query: "cd" });
    expect(found(real).count).toBe(1);
    expect(found(real).results[0]?.id).toBe("rec-a");
  });

  it("answers a blank query without searching, and still reports the index", async () => {
    const { worker } = await offlineWorker([makeIndexRecord({ text: "the deployment failed" })]);

    for (const query of ["", "   ", "---"]) {
      const call = await worker.send({ type: "SEARCH_MEMORY", query });
      expect(call.response.success).toBe(true);
      const data = found(call);
      expect(data.results).toEqual([]);
      expect(data.count).toBe(0);
      expect(data.indexed).toBe(1);
      expect(data.unmatchedTokens).toEqual([]);
    }
  });

  it("bounds the answer without hiding how much the index holds", async () => {
    const { worker } = await offlineWorker(many(12, "shared phrase"));

    const all = await worker.send({ type: "SEARCH_MEMORY", query: "shared" });
    expect(found(all).count).toBe(10);
    expect(found(all).indexed).toBe(12);
    expect(found(all).results).toHaveLength(10);

    const tight = await worker.send({ type: "SEARCH_MEMORY", query: "shared", limit: 3 });
    expect(found(tight).count).toBe(3);
    expect(found(tight).indexed).toBe(12);
    // A nonsense limit falls back to the default rather than to "no results", so a surface cannot
    // turn a bad control value into an empty history.
    const zero = await worker.send({ type: "SEARCH_MEMORY", query: "shared", limit: 0 });
    expect(found(zero).count).toBe(10);
  });

  it("reads a corrupted index as empty instead of failing the query", async () => {
    const { worker } = await offlineWorker();

    const corrupt: unknown[] = ["not an object", { records: "nope" }, { records: [{ eventId: 1 }] }];
    for (const value of corrupt) {
      worker.mock.storage.local.data[INDEX_STORAGE_KEY] = value as never;

      const call = await worker.send({ type: "SEARCH_MEMORY", query: "anything" });

      expect(call.response.success).toBe(true);
      expect(found(call).count).toBe(0);
      expect(found(call).indexed).toBe(0);

      const status = await worker.send({ type: "INDEX_STATUS" });
      expect((status.response.data as SearchIndexStatus).indexed).toBe(0);
      expect((status.response.data as SearchIndexStatus).providers).toEqual([]);
    }
  });

  it("drops an unreadable record from the view without rewriting storage", async () => {
    const { worker } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-good", recordId: "rec-good", text: "the deployment failed" }),
      { eventId: "evt-bad", recordId: "rec-bad" } as IndexRecord,
    ]);
    const before = JSON.stringify(storedIndex(worker.mock));

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "deployment" });

    expect(call.response.success).toBe(true);
    expect(found(call).count).toBe(1);
    // Counted as one, because the index *view* is one: a record nothing can read is not a record
    // held here, and reporting it would promise a hit that can never arrive.
    expect(found(call).indexed).toBe(1);
    expect(found(call).results[0]?.id).toBe("rec-good");
    expect(JSON.stringify(storedIndex(worker.mock))).toBe(before);
  });
});
