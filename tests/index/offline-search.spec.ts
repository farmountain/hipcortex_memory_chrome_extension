/**
 * Offline search with the runtime stopped (task 3.1, G3.9).
 *
 * The claim is "you can search your captured conversations while the runtime is not running", and
 * the only way to test it is to make every route out of the worker unavailable *and recorded*. So
 * `connectNative` throws, `fetch` throws, and both are asserted to have been untouched after a query
 * that returned a hit. A spec that merely did not have a runtime running would pass on a search that
 * quietly fell back to the network and failed.
 *
 * The positive control is the same message with `scope: "core"`: that one *must* touch the network,
 * or the absence above would be about a message the worker ignores rather than about the offline
 * path.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeIndexRecord, offlineWorker } from "../helpers/index-store.js";
import { makeCaptureEvent } from "../helpers/events.js";
import type { SearchIndexStatus, SearchResult } from "../../src/types/index.js";
import { recordAcknowledgedCapture } from "../../src/index/local.js";

function found(call: { readonly response: { data?: unknown } }): SearchResult {
  return call.response.data as SearchResult;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline search with the runtime stopped — G3.9 (task 3.1)", () => {
  it("answers with a capture the runtime has never been asked about", async () => {
    const { worker, fetchSpy, connectSpy } = await offlineWorker([
      makeIndexRecord({
        eventId: "evt-1",
        recordId: "rec-1",
        text: "the deployment failed on friday",
      }),
    ]);

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "deployment" });

    expect(call.response.success).toBe(true);
    const data = found(call);
    expect(data.source).toBe("local");
    expect(data.query).toBe("deployment");
    expect(data.count).toBe(1);
    expect(data.indexed).toBe(1);
    expect(data.unmatchedTokens).toEqual([]);

    const hit = data.results[0];
    expect(hit?.id).toBe("rec-1");
    expect(hit?.provider).toBe("chatgpt");
    expect(hit?.timestamp).toBe("2025-01-15T00:00:00.000Z");
    expect(hit?.target).toContain("deployment");
    expect(hit?.metadata?.conversationUrl).toBe("https://chatgpt.com/c/redacted");
    expect(hit?.metadata?.eventId).toBe("evt-1");

    // Nothing left the worker: not the native host, not the network, not the message channel.
    expect(connectSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(worker.mock.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("takes that path for a message that names no scope at all, rather than falling back to it", async () => {
    const { worker, fetchSpy } = await offlineWorker([makeIndexRecord({ text: "an offline capture" })]);

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "offline", limit: 5 });

    expect(found(call).source).toBe("local");
    expect(found(call).count).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does use the network when the runtime is asked for its own search, so the two paths differ", async () => {
    const { worker, fetchSpy } = await offlineWorker([
      makeIndexRecord({ recordId: "rec-1", text: "an offline capture" }),
    ]);

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "offline capture", scope: "core" });

    // Reads go over loopback HTTP and never over the native channel, so this is the whole of the
    // core path: a fetch at the loopback base URL. It is unavailable here, and the reply is
    // therefore not the index's record — which is what makes the offline hits above evidence that
    // the local path answered rather than a fallback that happened to work.
    expect(fetchSpy).toHaveBeenCalled();
    const data = call.response.data as SearchResult | undefined;
    expect(data?.results.map((hit) => hit.id) ?? []).not.toContain("rec-1");
  });

  it("matches every token, not any token", async () => {
    const { worker } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-a", recordId: "rec-a", text: "the deployment failed on friday" }),
      makeIndexRecord({ eventId: "evt-b", recordId: "rec-b", text: "a rollback was scheduled" }),
    ]);

    const both = await worker.send({ type: "SEARCH_MEMORY", query: "deployment rollback" });
    expect(found(both).count).toBe(0);
    expect(found(both).indexed).toBe(2);
    // Neither token is *absent* from the index — they are in different captures — and the field says
    // exactly that, which is how a surface can explain the empty result instead of only reporting it.
    expect(found(both).unmatchedTokens).toEqual([]);

    const absent = await worker.send({ type: "SEARCH_MEMORY", query: "deployment kubernetes" });
    expect(found(absent).count).toBe(0);
    expect(found(absent).unmatchedTokens).toEqual(["kubernetes"]);

    // One of the two tokens is enough to find the record it belongs to, which is what makes the
    // empty result above a statement about AND rather than about a broken index.
    const one = await worker.send({ type: "SEARCH_MEMORY", query: "deployment" });
    expect(found(one).count).toBe(1);
    expect(found(one).results[0]?.id).toBe("rec-a");
  });

  it("applies the provider filter in this browser", async () => {
    const { worker, fetchSpy } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-a", recordId: "rec-a", provider: "chatgpt", text: "shared phrase" }),
      makeIndexRecord({ eventId: "evt-b", recordId: "rec-b", provider: "claude", text: "shared phrase" }),
    ]);

    const filtered = await worker.send({ type: "SEARCH_MEMORY", query: "shared", provider: "claude" });

    expect(found(filtered).count).toBe(1);
    expect(found(filtered).results[0]?.id).toBe("rec-b");
    expect(found(filtered).results[0]?.provider).toBe("claude");
    // Filtering happens over the index; a provider filter is not a reason to ask the runtime.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("orders hits by capture time, newest first", async () => {
    const { worker } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-old", recordId: "rec-old", capturedAt: "2025-01-01T00:00:00.000Z", text: "deployment notes" }),
      makeIndexRecord({ eventId: "evt-new", recordId: "rec-new", capturedAt: "2025-03-01T00:00:00.000Z", text: "deployment notes" }),
      makeIndexRecord({ eventId: "evt-mid", recordId: "rec-mid", capturedAt: "2025-02-01T00:00:00.000Z", text: "deployment notes" }),
    ]);

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "deployment" });

    expect(found(call).results.map((hit) => hit.id)).toEqual(["rec-new", "rec-mid", "rec-old"]);
  });

  it("reports how much the index holds, so a surface can say what it searched", async () => {
    const { worker } = await offlineWorker([
      makeIndexRecord({ eventId: "evt-a", recordId: "rec-a", provider: "chatgpt" }),
      makeIndexRecord({ eventId: "evt-b", recordId: "rec-b", provider: "claude" }),
    ]);

    const call = await worker.send({ type: "INDEX_STATUS" });

    expect(call.response.success).toBe(true);
    const status = call.response.data as SearchIndexStatus;
    expect(status.indexed).toBe(2);
    // Read from the records: a filter can only offer a provider that has a capture behind it.
    expect(status.providers).toEqual(["chatgpt", "claude"]);
  });

  it("reads records the acknowledgement seam wrote, not only a literal seed", async () => {
    const { worker } = await offlineWorker();

    await recordAcknowledgedCapture(
      makeCaptureEvent({
        eventId: "evt-written",
        provider: "gemini",
        url: "https://gemini.google.com/app/redacted",
        capturedAt: "2025-04-01T00:00:00.000Z",
        messages: 1,
        text: "the migration script timed out",
      }),
      "rec-written",
      "spec-actor"
    );

    const call = await worker.send({ type: "SEARCH_MEMORY", query: "migration" });

    expect(found(call).count).toBe(1);
    expect(found(call).results[0]?.id).toBe("rec-written");
    expect(found(call).results[0]?.provider).toBe("gemini");
    expect(found(call).results[0]?.target).toContain("migration");
  });
});
