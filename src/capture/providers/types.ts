/**
 * The provider adapter contract — the boundary where volatile DOM knowledge is allowed to exist.
 *
 * Two rules shape this file, and both are load-bearing:
 *
 * 1. **Fail closed.** Every failure is a typed value with a code, never a `null` conversation and
 *    never a partial one. An adapter that returns "three of four turns" has produced a plausible
 *    wrong capture, which is worse than no capture at all — G8.7. A typed failure is *always*
 *    preferred to a wrong capture.
 * 2. **Configuration is code.** Ladders and landmarks are declared in the adapter module. They are
 *    never fetched, never read from storage, and never updated remotely — G8.4.
 *
 * Nothing in this file reasons about what a message *means*. There is no importance, no summary,
 * no entity, no goal. The adapter's whole job is to turn a DOM into `Message[]` without lying about
 * it.
 */

import type { Conversation, Provenance } from "../../schema/index.js";

/**
 * The closed set of ways extraction can fail.
 *
 * `DOM_SHAPE_UNRECOGNIZED` is first because it is the one the plan treats as the primary defence:
 * a structural landmark is missing, so the page is not the page this adapter was verified against,
 * and **no message text has been read at that point** — G8.3.
 */
export const EXTRACT_ERROR_CODES = [
  "DOM_SHAPE_UNRECOGNIZED",
  "EMPTY_CONVERSATION",
  "NO_ROLE_SIGNAL",
  "UNSUPPORTED_LAYOUT",
  "MESSAGE_COUNT_MISMATCH",
] as const;

export type ExtractErrorCode = (typeof EXTRACT_ERROR_CODES)[number];

/** The four slots every adapter must describe an ordered ladder for — G8.2. */
export const CAPTURE_SLOTS = ["conversationRoot", "turnContainer", "messageText", "roleSignal"] as const;

export type CaptureSlot = (typeof CAPTURE_SLOTS)[number];

/** Slot -> ladder of ordered CSS selectors, most specific first. */
export type SlotLadders = Readonly<Record<CaptureSlot, readonly string[]>>;

/**
 * Which ladder index each slot actually depended on — G8.2.
 *
 * For `conversationRoot` and `turnContainer` the slot resolves once, so this is the index chosen.
 * For `messageText` and `roleSignal` the slot resolves *per turn*, and different roles legitimately
 * need different rungs (an assistant's text sits under `.markdown`, the user's does not), so this
 * records the **deepest** index any message needed. That is the drift signal 8.x cares about: it
 * says how far down the ladder this page forced us, and a value that moves is the early warning
 * that a selector has rotted. A slot that never resolved reports `-1`.
 */
export type RungRecord = Readonly<Record<CaptureSlot, number>>;

export interface ExtractInput {
  /** The document to read. Never mutated — G1.6. */
  readonly document: Document;
  /** The page's current URL, used for the canonical conversation URL. */
  readonly url: string;
  /** Page title, when the caller has a better one than `document.title`. */
  readonly title?: string;
  /** ISO-8601 UTC capture instant. Injectable so a spec can assert an exact value. */
  readonly capturedAt?: string;
}

export interface ExtractFailure {
  readonly ok: false;
  readonly code: ExtractErrorCode;
  /** Human-readable, safe to log: names the slot, rung or turn index, never message text. */
  readonly detail: string;
  readonly slot?: CaptureSlot;
  /** Ladder index that failed, when the failure is attributable to one rung. */
  readonly rung?: number;
}

export interface ExtractSuccess {
  readonly ok: true;
  readonly conversation: Conversation;
  /**
   * Exactly six fields, built here rather than by the caller, so that `provenance.provider` cannot
   * drift from `adapter.id` — G1.5. `eventId` is deliberately absent: it identifies the capture
   * *attempt* and belongs to the event, not to the source.
   */
  readonly provenance: Provenance;
  readonly rungs: RungRecord;
}

export type ExtractResult = ExtractSuccess | ExtractFailure;

export interface ProviderAdapter {
  /** Stable adapter id. Also the `action` suffix (`capture:<id>`), the provenance `provider`, and
   * the tag added to the egress record. */
  readonly id: string;
  readonly displayName: string;
  /** Bumped whenever a ladder entry changes, so a stored capture can be traced to a selector set. */
  readonly adapterVersion: string;
  /** The date the ladders were last verified against a live page. Must not be in the future. */
  readonly verifiedAt: string;
  /** Structural elements that must exist before any message text is read — G8.3. */
  readonly landmarks: readonly string[];
  readonly ladders: SlotLadders;
  /** `true` when the URL belongs to this provider's conversation surface. */
  matches(url: string): boolean;
  extract(input: ExtractInput): ExtractResult;
}
