/**
 * Index-store helpers for the offline search specs (tasks 3.1 – 3.4, G3.9).
 *
 * `seedIndex` writes the literal on-disk shape — `{ records: [ … ] }` under `INDEX_STORAGE_KEY` — so
 * the reader is asserted against the documented shape rather than against whatever the writer
 * happens to emit. The key and the tokenizer are imported from the modules rather than spelled again
 * here: a rename cannot leave a spec writing to a key nothing reads, and a seeded record carries the
 * same tokens a captured one would.
 */

import { vi } from "vitest";

import { INDEX_STORAGE_KEY } from "../../src/index/local.js";
import { tokenize } from "../../src/index/record.js";
import type { IndexRecord } from "../../src/index/record.js";
import type { ChromeMock } from "./chrome-mock.js";
import { loadWorker } from "./worker.js";
import type { WorkerHarness } from "./worker.js";

/** A capture time these specs can override; the seeded default is the oldest they use. */
export const SEEDED_AT = "2025-01-15T00:00:00.000Z";

export function makeIndexRecord(overrides: Partial<IndexRecord> = {}): IndexRecord {
  const text = overrides.text ?? "hello world";
  return {
    eventId: overrides.eventId ?? "evt-seed-1",
    recordId: overrides.recordId ?? "rec-seed-1",
    actor: overrides.actor ?? "spec-actor",
    provider: overrides.provider ?? "chatgpt",
    capturedAt: overrides.capturedAt ?? SEEDED_AT,
    conversationUrl: overrides.conversationUrl ?? "https://chatgpt.com/c/redacted",
    text,
    tokens: overrides.tokens ?? tokenize(text),
  };
}

/** Write records straight into local storage in the shape the module reads back. */
export function seedIndex(mock: ChromeMock, records: readonly IndexRecord[]): void {
  mock.storage.local.data[INDEX_STORAGE_KEY] = { records: records.map((record) => ({ ...record })) };
}

/** The raw stored value, for specs about what a write actually persisted. */
export function storedIndex(mock: ChromeMock): unknown {
  return mock.storage.local.data[INDEX_STORAGE_KEY];
}

/** The records the store holds right now, read the way the module reads them. */
export function storedRecords(mock: ChromeMock): IndexRecord[] {
  const value = storedIndex(mock);
  if (value === undefined) return [];
  return ((value as { records?: IndexRecord[] }).records ?? []).map((record) => ({ ...record }));
}

export interface OfflineWorker {
  readonly worker: WorkerHarness;
  readonly fetchSpy: ReturnType<typeof vi.fn>;
  readonly connectSpy: ReturnType<typeof vi.fn>;
}

/**
 * A worker whose runtime is stopped and whose network is unavailable, both recorded.
 *
 * "The runtime is stopped" is not a claim about a live socket: every route out of the worker is
 * closed and instrumented, so a search that answered could not have used one. A spec that merely did
 * not have a runtime running would pass on a search that quietly fell back to the network and then
 * failed. Call `vi.unstubAllGlobals()` when the spec is done with it.
 */
export async function offlineWorker(seed: readonly IndexRecord[] = []): Promise<OfflineWorker> {
  const worker = await loadWorker();
  seedIndex(worker.mock, seed);

  const connectSpy = vi.fn((): never => {
    throw new Error("the runtime is stopped");
  });
  worker.mock.runtime.connectNative = connectSpy;

  const fetchSpy = vi.fn((): never => {
    throw new Error("this spec runs with no network");
  });
  vi.stubGlobal("fetch", fetchSpy);

  return { worker, fetchSpy, connectSpy };
}
