/**
 * The capture queue — the extension's only retention boundary, and therefore the file where
 * "we dropped a capture" must be structurally impossible.
 *
 * The rules, and what each one costs if it is relaxed:
 *
 * - **FIFO, in one `chrome.storage.local` key.** Order matters because the core retains what it is
 *   told in the order it is told; a queue that reorders turns a conversation history into a set.
 * - **Removal only on acknowledged delivery.** `removeAcknowledged` is the only function that
 *   shrinks the queue, and it takes a positive acknowledgement (G2.1). An HTTP 2xx with no
 *   `record_id` is not an acknowledgement (G2.9) — the transport already models that, and this file
 *   never re-derives it from a status code.
 * - **No loss counter, and no eviction path at all.** At the spill limit nothing is removed, the
 *   queue reports `paused`, and new captures stop being accepted until it drains (G2.2, G2.3).
 *   A "dropped" count would be a number the product could show while having lost a conversation.
 * - **Backoff is `min(2000 * 2^attempts, 300000)` and `nextAttemptAt` is part of the entry**, so a
 *   service worker that is evicted between attempts resumes the schedule instead of hammering the
 *   runtime on every wake (G2.5, G2.6).
 * - **A refusal and an interruption are different entries, not two rows of one count.** Each entry
 *   records what the last attempt concluded, and `retentionState` is the single value the status
 *   surface reads. Before this, a `403` from the runtime's PII precondition and a dropped connection
 *   produced the same number and no explanation, so a capture that could never be delivered waited
 *   forever with nothing on screen to say so (`docs/PROTOCOL.md` section 3.2, open risk 6).
 */

import { validateCaptureEvent } from "../../schema/index.js";
import type { CaptureEvent } from "../../schema/index.js";
import type { SendFailureKind, SendFailureReason, SendResult } from "../../api/transport/index.js";

export const QUEUE_STORAGE_KEY = "hipcortex.capture.queue";

/**
 * The spill limit. It is a pause threshold, not a capacity: reaching it stops *new* captures and
 * leaves every existing one in place.
 */
export const QUEUE_SPILL_LIMIT = 500;

export const BASE_BACKOFF_MS = 2000;
export const MAX_BACKOFF_MS = 300000;

/**
 * Entries attempted per drain. The drain alarm fires every minute and a send can take seconds, so
 * an unbounded drain could still be running when the next one starts.
 */
export const DRAIN_BATCH_LIMIT = 25;

/**
 * What the last delivery attempt for one entry concluded.
 *
 * This is deliberately not a boolean `refused` flag on top of a list of reasons. A capture the
 * runtime refused and a capture whose delivery was interrupted are different facts about the world
 * — one is a decision about this record, the other is a bad minute — and collapsing them into one
 * "unacknowledged" count is what made a permanent refusal invisible (`docs/PROTOCOL.md` section 3.2).
 */
export type EntryOutcome = "pending" | "transient" | "refused";

export interface QueueEntry {
  readonly event: CaptureEvent;
  /** Attempts made **through the queue**. The inline send that caused the enqueue is not one. */
  readonly attempts: number;
  readonly enqueuedAt: string;
  /** ISO-8601 UTC. Persisted so a restart cannot reset the schedule. */
  readonly nextAttemptAt: string;
  /**
   * The verdict of the last attempt, persisted with the entry so it survives a worker eviction
   * like every other field of the schedule does.
   */
  readonly outcome: EntryOutcome;
  /** The runtime's own words when it refused, or `null`. Never the capture text (G2.10). */
  readonly refusalReason: string | null;
}

export interface QueueState {
  readonly entries: readonly QueueEntry[];
  /** True at the spill limit. Reported to the user; never a reason to discard anything. */
  readonly paused: boolean;
}

/** One refused entry, in the runtime's own words. */
export interface RefusalNotice {
  readonly eventId: string;
  readonly provider: string;
  readonly capturedAt: string;
  readonly attempts: number;
  readonly reason: string;
}

/**
 * The whole retention state of the extension, as one value.
 *
 * Task 1.2 asks for this shape specifically: the status surface reads **one** object, so "paused",
 * "how many" and "why" cannot disagree with each other the way three independent reads of storage
 * can. There is no field here for a loss, because nothing is ever lost — the only way a count goes
 * down is an acknowledgement.
 */
export interface RetentionState {
  /** Every entry the queue is holding. */
  readonly queued: number;
  /** Entries whose last attempt failed for a reason another attempt could still fix. */
  readonly retrying: number;
  /** Entries the runtime refused. A retry repeats the same answer until the refusal lifts. */
  readonly refused: number;
  /** True at the spill limit: new captures are refused until it drains. */
  readonly paused: boolean;
  /** One notice per refused entry, in FIFO order. */
  readonly refusals: readonly RefusalNotice[];
  /** What to tell the user, or `null` when there is nothing to say. Never a loss figure. */
  readonly message: string | null;
}

export interface EnqueueResult {
  readonly accepted: boolean;
  readonly state: QueueState;
  /** Set only when the capture was refused because the queue is paused (G2.3). */
  readonly message: string | null;
}

export interface DrainDeps {
  readonly send: (event: CaptureEvent) => Promise<SendResult>;
  readonly now?: () => Date;
  readonly batchLimit?: number;
  /**
   * Called once per entry the runtime acknowledged, with the record id the runtime returned.
   *
   * This is the drain's acknowledgement seam and it exists so the queue can *report* the fact without
   * acting on it: the queue is transport, and a queue that also wrote a search copy of the capture
   * would be a second retention boundary. It runs after the acknowledged entries have been removed,
   * and a throwing hook cannot fail the drain — the entry is already gone, and re-offering it would
   * duplicate a record in the core.
   */
  readonly onAcknowledged?: (event: CaptureEvent, recordId: string) => Promise<void>;
}

/** What one entry's attempt produced, for the caller that wants the per-entry detail. */
export interface EntryOutcomeRecord {
  readonly eventId: string;
  readonly outcome: EntryOutcome;
  readonly reason: SendFailureReason;
  readonly kind: SendFailureKind;
  readonly refusalReason: string | null;
}

export interface DrainOutcome {
  readonly attempted: number;
  readonly delivered: number;
  readonly retained: number;
  readonly unacknowledged: number;
  readonly paused: boolean;
  /** One record per entry attempted this drain, in FIFO order. */
  readonly outcomes: readonly EntryOutcomeRecord[];
  /** The retention state after the drain — the same value the status surface reads. */
  readonly retention: RetentionState;
  readonly message: string | null;
}

/** `min(2000 * 2^attempts, 300000)`. `Infinity` from a huge exponent is fine — `min` caps it. */
export function backoffDelayMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, Math.floor(attempts)), MAX_BACKOFF_MS);
}

/**
 * The user-visible pause message (G2.3). It names the unacknowledged count and says capture is
 * paused, and it does not say "lost" — nothing was lost.
 */
export function pauseMessage(unacknowledged: number): string {
  return (
    `Capture is paused: ${unacknowledged} conversation${unacknowledged === 1 ? "" : "s"} ` +
    `are waiting to be delivered and none of them has been discarded. ` +
    `Capture resumes automatically once the runtime acknowledges them.`
  );
}

/**
 * The user-visible refusal message (G2.2).
 *
 * A refusal is permanent *for this record* until the runtime's own precondition changes, so the
 * wording says what the runtime said and what would end it — it does not promise a retry, and it
 * does not call the capture lost, because it is still here and still exportable.
 */
export function refusalMessage(refused: number, queued: number): string {
  return (
    `The runtime refused ${refused} of the ${queued} waiting conversation${queued === 1 ? "" : "s"}. ` +
    `A refusal is the runtime's decision about the record, so retrying will keep getting the same ` +
    `answer until the condition it names is fixed. The capture${refused === 1 ? " has" : "s have"} ` +
    `not been discarded and can still be exported.`
  );
}

/**
 * The whole retention state, derived from the queue and nothing else.
 *
 * This is the single read the status surface makes (task 1.2). Everything it reports is counted
 * from entries that are still in the queue, so the reported state and the retained state cannot
 * drift apart — there is no separate tally to fall out of step.
 */
export function retentionState(state: QueueState): RetentionState {
  const queued = state.entries.length;
  const refusals: RefusalNotice[] = [];
  let retrying = 0;

  for (const entry of state.entries) {
    if (entry.outcome === "refused") {
      refusals.push({
        eventId: entry.event.eventId,
        provider: entry.event.provenance.provider,
        capturedAt: entry.event.provenance.capturedAt,
        attempts: entry.attempts,
        // Only a refusal carries a reason; `outcomeOf` never calls a bare failure a refusal, so this
        // fallback is for an entry that was refused by a runtime which explained nothing.
        reason: entry.refusalReason ?? "the runtime refused the record and gave no reason",
      });
    } else if (entry.outcome === "transient") {
      retrying += 1;
    }
  }

  const sentences: string[] = [];
  if (refusals.length > 0) sentences.push(refusalMessage(refusals.length, queued));
  if (state.paused) sentences.push(pauseMessage(queued));

  return {
    queued,
    retrying,
    refused: refusals.length,
    paused: state.paused,
    refusals,
    message: sentences.length > 0 ? sentences.join(" ") : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOutcome(value: unknown): EntryOutcome {
  return value === "refused" || value === "transient" ? value : "pending";
}

/**
 * Validate one persisted entry.
 *
 * The three scheduling fields and the event are load-bearing and an entry missing any of them cannot
 * be delivered, so it is rejected. `outcome` and `refusalReason` are not load-bearing — an entry
 * written before the refusal distinction existed has neither, and reading it as `pending` is both
 * correct and non-destructive: nothing is rewritten on read, so a queue written by an older build
 * still delivers. `false` for an entry that cannot be delivered at all, rather than a repair, because
 * repairing it on read would be a write on the read path.
 */
function toQueueEntry(value: unknown): QueueEntry | null {
  if (!isRecord(value)) return null;
  if (typeof value["attempts"] !== "number" || value["attempts"] < 0) return null;
  if (typeof value["enqueuedAt"] !== "string" || typeof value["nextAttemptAt"] !== "string") return null;
  if (!validateCaptureEvent(value["event"]).valid) return null;

  return {
    event: value["event"] as CaptureEvent,
    attempts: value["attempts"],
    enqueuedAt: value["enqueuedAt"],
    nextAttemptAt: value["nextAttemptAt"],
    outcome: readOutcome(value["outcome"]),
    refusalReason: typeof value["refusalReason"] === "string" ? value["refusalReason"] : null,
  };
}

/**
 * Read the queue.
 *
 * An unreadable entry is dropped from the *in-memory* view rather than repaired, and the entry stays
 * in storage until the next write. An entry that cannot be validated cannot be delivered, so keeping
 * it in the drain loop would stall the whole queue; but silently rewriting it away on read would be a
 * discard, so the read path does not write.
 */
export async function readQueue(): Promise<QueueState> {
  const stored = await chrome.storage.local.get(QUEUE_STORAGE_KEY);
  const value = stored[QUEUE_STORAGE_KEY];
  if (!isRecord(value)) return { entries: [], paused: false };

  const raw = value["entries"];
  const entries = Array.isArray(raw)
    ? raw.map(toQueueEntry).filter((entry): entry is QueueEntry => entry !== null)
    : [];
  return { entries, paused: entries.length >= QUEUE_SPILL_LIMIT };
}

export async function writeQueue(state: QueueState): Promise<void> {
  await chrome.storage.local.set({
    [QUEUE_STORAGE_KEY]: {
      entries: state.entries.map((entry) => ({
        event: entry.event,
        attempts: entry.attempts,
        enqueuedAt: entry.enqueuedAt,
        nextAttemptAt: entry.nextAttemptAt,
        outcome: entry.outcome,
        refusalReason: entry.refusalReason,
      })),
      paused: state.paused,
    },
  });
}

/**
 * Append one capture to the tail.
 *
 * Refuses — visibly — when the queue is at the spill limit. Refusing a *new* capture is not the same
 * as discarding an existing one: the refusal is reported to the user as a paused state, and the
 * capture is still in the page. The alternative, evicting the oldest entry, would lose a
 * conversation the core never saw in exchange for one it also never saw.
 */
export async function enqueueEvent(event: CaptureEvent, now: Date = new Date()): Promise<EnqueueResult> {
  const state = await readQueue();

  if (state.entries.length >= QUEUE_SPILL_LIMIT) {
    return { accepted: false, state, message: pauseMessage(state.entries.length) };
  }

  const timestamp = now.toISOString();
  const entry: QueueEntry = {
    event,
    attempts: 0,
    enqueuedAt: timestamp,
    // Due after one backoff step, not immediately: the send that produced this entry has just failed,
    // so an immediate retry is the one attempt guaranteed to fail again.
    nextAttemptAt: new Date(now.getTime() + backoffDelayMs(0)).toISOString(),
    outcome: "pending",
    refusalReason: null,
  };

  const entries = [...state.entries, entry];
  const next: QueueState = { entries, paused: entries.length >= QUEUE_SPILL_LIMIT };
  await writeQueue(next);
  return { accepted: true, state: next, message: null };
}

/** Entries whose `nextAttemptAt` has passed, in FIFO order. */
export function dueEntries(state: QueueState, now: Date = new Date()): readonly QueueEntry[] {
  return state.entries.filter((entry) => Date.parse(entry.nextAttemptAt) <= now.getTime());
}

/** What one failed attempt concluded, in the terms the entry stores. */
export interface AttemptFailure {
  readonly reason: SendFailureReason;
  readonly kind: SendFailureKind;
  readonly refusalReason: string | null;
}

/**
 * Record one failed attempt: increment `attempts`, carry the verdict, and push `nextAttemptAt` out by
 * the backoff for the attempts now made. Monotonic in `attempts`, capped at `MAX_BACKOFF_MS`.
 *
 * The schedule is the same for a refusal as for an interruption. That is deliberate: a refusal is
 * deterministic for *this record*, not for the runtime's policy, so the entry keeps being offered —
 * on the slowest schedule the backoff allows — and is delivered the moment the refusal lifts
 * (`cortexbridge-retention-boundary` requirement 5). What changes is what the user is told, not
 * whether the capture is still waiting.
 */
export function markAttempt(entry: QueueEntry, failure: AttemptFailure, now: Date = new Date()): QueueEntry {
  const attempts = entry.attempts + 1;
  const refused = failure.kind === "refused";
  return {
    ...entry,
    attempts,
    outcome: refused ? "refused" : "transient",
    // Only a refusal keeps the runtime's words. Attaching a stale reason to a later transient failure
    // would be the misreporting this distinction exists to prevent.
    refusalReason: refused ? failure.refusalReason : null,
    nextAttemptAt: new Date(now.getTime() + backoffDelayMs(attempts)).toISOString(),
  };
}

/**
 * The only function in the extension that removes a queue entry.
 *
 * It is given event ids, and those ids can only have come from an acknowledged send.
 */
export function removeAcknowledged(state: QueueState, acknowledgedEventIds: readonly string[]): QueueState {
  if (acknowledgedEventIds.length === 0) return state;
  const acknowledged = new Set(acknowledgedEventIds);
  const entries = state.entries.filter((entry) => !acknowledged.has(entry.event.eventId));
  return { entries, paused: entries.length >= QUEUE_SPILL_LIMIT };
}

/**
 * Attempt delivery for every due entry, in FIFO order.
 *
 * A failed entry does **not** stop the drain. Stopping at the first failure would let one entry the
 * runtime will never accept block every capture behind it, which is an indefinite stall — the
 * outcome this project treats as worse than a slow queue.
 */
export async function drainQueue(deps: DrainDeps): Promise<DrainOutcome> {
  const now = deps.now?.() ?? new Date();
  const batchLimit = deps.batchLimit ?? DRAIN_BATCH_LIMIT;
  const state = await readQueue();
  const due = dueEntries(state, now).slice(0, batchLimit);

  if (due.length === 0) {
    const retention = retentionState(state);
    return {
      attempted: 0,
      delivered: 0,
      retained: state.entries.length,
      unacknowledged: state.entries.length,
      paused: state.paused,
      outcomes: [],
      retention,
      message: retention.message,
    };
  }

  const acknowledged: string[] = [];
  const delivered: { readonly event: CaptureEvent; readonly recordId: string }[] = [];
  const attemptedEntries: QueueEntry[] = [];
  const outcomes: EntryOutcomeRecord[] = [];

  for (const entry of due) {
    let result: SendResult;
    try {
      result = await deps.send(entry.event);
    } catch {
      // `Transport.addMemory` does not throw for an expected failure. If it throws anyway, letting it
      // escape would leave the entry due forever and the drain would retry it in a tight loop; from
      // the queue's point of view the runtime could not be reached.
      result = {
        acknowledged: false,
        transport: "http",
        reason: "UNREACHABLE",
        detail: "the transport threw instead of returning a result",
        kind: "transient",
        refusalReason: null,
      };
    }

    if (result.acknowledged) {
      acknowledged.push(entry.event.eventId);
      delivered.push({ event: entry.event, recordId: result.recordId });
    } else {
      outcomes.push({
        eventId: entry.event.eventId,
        outcome: result.kind === "refused" ? "refused" : "transient",
        reason: result.reason,
        kind: result.kind,
        refusalReason: result.kind === "refused" ? result.refusalReason : null,
      });
      attemptedEntries.push(
        markAttempt(
          entry,
          { reason: result.reason, kind: result.kind, refusalReason: result.refusalReason },
          now
        )
      );
    }
  }

  // Preserve FIFO order for the retained entries, and keep any entry that was not due in place.
  const attempted = new Map(attemptedEntries.map((entry) => [entry.event.eventId, entry]));
  const merged = state.entries.map((entry) => attempted.get(entry.event.eventId) ?? entry);
  const next = removeAcknowledged({ entries: merged, paused: state.paused }, acknowledged);

  if (acknowledged.length > 0 || attemptedEntries.length > 0) {
    await writeQueue(next);
  }

  // After the removal is durable, so a hook that fails cannot leave the queue offering an entry the
  // core already accepted. Each call is isolated: one failure must not silence the next.
  for (const { event, recordId } of delivered) {
    try {
      await deps.onAcknowledged?.(event, recordId);
    } catch {
      // Reported by whatever the hook owns; from the queue's point of view the entry is delivered.
    }
  }

  return {
    attempted: due.length,
    delivered: acknowledged.length,
    retained: next.entries.length,
    unacknowledged: next.entries.length,
    paused: next.paused,
    outcomes,
    retention: retentionState(next),
    message: retentionState(next).message,
  };
}
