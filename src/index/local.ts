/**
 * The local lexical index — search over acknowledged captures with the runtime stopped (G3.9).
 *
 * Two rules make this safe to have at all, and both are structural rather than documented:
 *
 * 1. **A record is written only after an acknowledgement.** `recordAcknowledgedCapture` is called
 *    from the two places that observe `success: true` plus a non-empty `record_id` — the pipeline's
 *    direct delivery and the drain's send wrapper. So the index can only ever hold something the
 *    core already has, which is what makes it a cache instead of a second retention boundary.
 * 2. **Losing it loses nothing but the offline path.** The store is bounded, and reaching the bound
 *    evicts the oldest *index record*. That is the opposite of the queue's behaviour on purpose and
 *    is only legitimate because of rule 1: an evicted index record is still in the core.
 *
 * Nothing here calls the network. `tests/quality/source-scans.spec.ts` asserts that over this tree
 * with a positive control, so the offline path cannot acquire a request by accident.
 *
 * Two naming notes that are load-bearing rather than cosmetic: the stored list is `records` (not
 * `entries`, which the G2.1 containment scan reserves for the queue — reaching a queued entry from
 * outside the queue is the thing that scan forbids), and nothing here is named "remember", "recall"
 * or "forget", because this is retention of a cache and not recollection (G2.1).
 */

import type { CaptureEvent } from "../schema/index.js";
import { buildIndexRecord, excerptFor, tokenize } from "./record.js";
import type { IndexRecord } from "./record.js";

export const INDEX_STORAGE_KEY = "hipcortex.capture.index";

/** Records kept before the oldest index record is evicted. */
export const INDEX_MAX_RECORDS = 500;

/** Results returned when a query does not ask for a count. */
export const INDEX_DEFAULT_LIMIT = 10;

export interface RecordResult {
  readonly indexed: number;
  readonly evicted: number;
  /**
   * True when the write could not be made. The capture is delivered either way; only the offline
   * copy of it is missing, which is what a cache being a cache means. Reported rather than thrown so
   * a storage failure cannot turn an acknowledged capture into a failed one.
   */
  readonly failed: boolean;
}

export interface IndexQuery {
  readonly text: string;
  /** Case-insensitive exact provider match, applied locally (G3.9). */
  readonly provider?: string;
  readonly limit?: number;
}

export interface IndexHit {
  readonly record: IndexRecord;
  /** The query tokens that this record contained, in query order. */
  readonly matchedTokens: readonly string[];
  /** The stored text around the match — what makes the hit checkable by the user. */
  readonly excerpt: string;
}

export interface IndexSearchResult {
  readonly hits: readonly IndexHit[];
  /** Query tokens that matched nothing, so a surface can say what narrowed the search away. */
  readonly unmatchedTokens: readonly string[];
  /** How many records the index held when this query ran. */
  readonly indexed: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Validate one persisted record.
 *
 * A record whose text or tokens cannot be read is dropped from the *view* rather than repaired, and
 * storage is left alone: this is a cache, so a dropped record costs an offline hit and nothing else,
 * and the read path must not write. The text is required and the tokens are not recomputed from it —
 * a record written by an older build that stored one without the other is not something to guess at.
 */
function toIndexRecord(value: unknown): IndexRecord | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const strings = ["eventId", "recordId", "actor", "provider", "capturedAt", "conversationUrl", "text"];
  for (const key of strings) {
    if (typeof raw[key] !== "string") return null;
  }

  const tokens = raw["tokens"];
  if (!Array.isArray(tokens) || !tokens.every((token) => typeof token === "string")) return null;

  return {
    eventId: raw["eventId"] as string,
    recordId: raw["recordId"] as string,
    actor: raw["actor"] as string,
    provider: raw["provider"] as string,
    capturedAt: raw["capturedAt"] as string,
    conversationUrl: raw["conversationUrl"] as string,
    text: raw["text"] as string,
    tokens: tokens as readonly string[],
  };
}

/** Every readable record in the index, oldest write first. */
export async function readIndex(): Promise<readonly IndexRecord[]> {
  const stored = await chrome.storage.local.get(INDEX_STORAGE_KEY);
  const value = asRecord(stored[INDEX_STORAGE_KEY]);
  if (!value) return [];

  const raw = value["records"];
  if (!Array.isArray(raw)) return [];
  return raw.map(toIndexRecord).filter((record): record is IndexRecord => record !== null);
}

async function writeIndex(records: readonly IndexRecord[]): Promise<void> {
  await chrome.storage.local.set({ [INDEX_STORAGE_KEY]: { records } });
}

/**
 * Record one acknowledged capture.
 *
 * Call this only from a place that has just seen `success: true` **and** a non-empty `record_id`.
 * An empty `recordId` is refused here as well, so a caller cannot record a capture against an id the
 * core never produced.
 *
 * A repeated `eventId` replaces the earlier record instead of appending a second one: one capture
 * attempt is one index record, and two records for one core record would make a hit look like two
 * conversations. At the bound, the oldest record is evicted — see the header for why that is allowed
 * here and forbidden for the queue.
 *
 * A storage failure is reported in `failed` rather than thrown. The capture is already acknowledged
 * at this point, and a cache that can fail a delivery is a cache that has become load-bearing.
 */
export async function recordAcknowledgedCapture(
  event: CaptureEvent,
  recordId: string,
  actor: string
): Promise<RecordResult> {
  try {
    if (recordId.length === 0) {
      const current = await readIndex();
      return { indexed: current.length, evicted: 0, failed: false };
    }

    const current = await readIndex();
    const kept = current.filter((record) => record.eventId !== event.eventId);
    const rebuilt = buildIndexRecord(event, recordId, actor);
    const appended = [...kept, rebuilt];

    let evicted = 0;
    while (appended.length > INDEX_MAX_RECORDS) {
      appended.shift();
      evicted += 1;
    }

    await writeIndex(appended);
    return { indexed: appended.length, evicted, failed: false };
  } catch {
    return { indexed: await indexSize().catch(() => 0), evicted: 0, failed: true };
  }
}

function toLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return INDEX_DEFAULT_LIMIT;
  return Math.floor(value);
}

/**
 * Query the index. No transport is constructed, resolved or called on this path.
 *
 * A record matches when every query token is in it (AND). Tokens shorter than two characters are
 * dropped by `tokenize`, so a one-character query matches nothing rather than everything — an empty
 * success, which is the answer this path is specified to give.
 */
export async function searchIndex(query: IndexQuery): Promise<IndexSearchResult> {
  const records = await readIndex();
  const asked = tokenize(query.text);
  const provider = query.provider?.toLowerCase();

  const scoped = provider
    ? records.filter((record) => record.provider.toLowerCase() === provider)
    : records;

  if (asked.length === 0) {
    return { hits: [], unmatchedTokens: [], indexed: scoped.length };
  }

  const hits: IndexHit[] = [];
  const elsewhere = new Set<string>(asked);

  for (const record of scoped) {
    const present = new Set(record.tokens);
    const matchedTokens = asked.filter((token) => present.has(token));
    for (const token of matchedTokens) elsewhere.delete(token);
    if (matchedTokens.length !== asked.length) continue;
    hits.push({ record, matchedTokens, excerpt: excerptFor(record, matchedTokens) });
  }

  // Newest capture first. This is a fact read off the records, not a judgement about them: the order
  // is visible in the result itself, and nothing is placed higher for being *like* the query.
  const ordered = [...hits].sort((left, right) => {
    const byTime = Date.parse(right.record.capturedAt) - Date.parse(left.record.capturedAt);
    return byTime !== 0 ? byTime : left.record.eventId.localeCompare(right.record.eventId);
  });

  return {
    hits: ordered.slice(0, toLimit(query.limit)),
    unmatchedTokens: [...elsewhere],
    indexed: scoped.length,
  };
}

/**
 * Remove every index record and report how many were removed.
 *
 * Deliberately a different action from anything that touches the queue: clearing the index changes
 * only what can be found offline, and the undelivered captures are not consulted, counted down or
 * written by this function.
 */
export async function clearIndex(): Promise<number> {
  const records = await readIndex();
  await chrome.storage.local.remove(INDEX_STORAGE_KEY);
  return records.length;
}

/** How many records the index holds — what a surface reports as "searchable offline". */
export async function indexSize(): Promise<number> {
  return (await readIndex()).length;
}

/**
 * The distinct providers the index holds, in first-seen order.
 *
 * Read out of the records rather than declared anywhere, so a provider filter can only offer a value
 * that has a capture behind it — and so no UI layer has to carry a list of provider names.
 */
export async function indexProviders(): Promise<readonly string[]> {
  const records = await readIndex();
  const seen = new Set<string>();
  for (const record of records) seen.add(record.provider);
  return [...seen];
}
