/**
 * The local index record — what one acknowledged capture contributes to offline search (G3.9).
 *
 * This is a **cache over records the core already has**, never a copy that could become the only
 * copy. That is enforced where the record is written (`local.ts` records a capture only after an
 * acknowledgement), not here; what this module decides is only *what a hit can be explained by*.
 *
 * The stored `text` and the stored `tokens` are derived from the same string. That is the property
 * that makes a hit checkable: every token in `tokens` occurs in `text`, so the excerpt a surface
 * shows always contains the text that matched. A token set computed from a different (longer) string
 * would let the index match a word it cannot show the user.
 *
 * There is no scoring, no weighting and no similarity here. A match is an exact token; the ordering
 * the query applies is the record's own `capturedAt`.
 */

import type { CaptureEvent } from "../schema/index.js";

/** Characters of a conversation kept per record. Beyond this the tail is not indexed. */
export const INDEX_MAX_CHARS = 3000;

/** Distinct tokens kept per record, in first-appearance order. */
export const INDEX_MAX_TOKENS = 400;

/** Tokens shorter than this are dropped: single characters match nearly everything. */
export const INDEX_MIN_TOKEN_CHARS = 2;

/** Characters of stored text shown around a match. */
export const EXCERPT_CHARS = 240;

export interface IndexRecord {
  /** The capture attempt this record came from. */
  readonly eventId: string;
  /** The core's id for the stored record — what a hit resolves to. */
  readonly recordId: string;
  /** The actor the capture was delivered under, so a hit can be looked up again. */
  readonly actor: string;
  readonly provider: string;
  readonly capturedAt: string;
  readonly conversationUrl: string;
  /** Conversation text, messages separated by a newline, truncated to `INDEX_MAX_CHARS`. */
  readonly text: string;
  /** Distinct lowercase word tokens of `text`, capped at `INDEX_MAX_TOKENS`. */
  readonly tokens: readonly string[];
}

/**
 * Split text into comparable tokens.
 *
 * Unicode word runs rather than an ASCII class, so a conversation in a non-Latin script is indexed
 * rather than silently unsearchable. Lowercased because matching is case-insensitive, and deduped in
 * first-appearance order so the stored list is a set that reads like the conversation.
 */
export function tokenize(text: string): readonly string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const run of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const token = run[0];
    if (token.length < INDEX_MIN_TOKEN_CHARS || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= INDEX_MAX_TOKENS) break;
  }
  return tokens;
}

/**
 * The text one event contributes to the index.
 *
 * Messages are joined in the conversation's own order so the stored text reads like the conversation,
 * and the whole thing is truncated once — at the end — so the truncation cannot fall between a token
 * and the text it came from.
 */
export function indexText(event: CaptureEvent): string {
  const text = event.conversation.messages.map((message) => message.text).join("\n");
  return text.length > INDEX_MAX_CHARS ? text.slice(0, INDEX_MAX_CHARS) : text;
}

/**
 * Build the record for one acknowledged capture.
 *
 * `recordId` and `actor` are passed in rather than read from the event because neither is knowable
 * from the capture: the id is the core's answer and the actor is the settings value the send used.
 */
export function buildIndexRecord(
  event: CaptureEvent,
  recordId: string,
  actor: string
): IndexRecord {
  const text = indexText(event);
  return {
    eventId: event.eventId,
    recordId,
    actor,
    provider: event.provenance.provider,
    capturedAt: event.provenance.capturedAt,
    conversationUrl: event.provenance.conversationUrl,
    text,
    tokens: tokenize(text),
  };
}

/**
 * The stored text to show for a match.
 *
 * The window around the first matched token, not the head of the conversation: a hit is only
 * explained if the user can read the text that caused it. With no matched token (a record returned
 * because a filter, not a token, selected it) the head of the text is shown, which is a weaker claim
 * and is why `matchedTokens` travels with the hit.
 */
export function excerptFor(record: IndexRecord, matchedTokens: readonly string[]): string {
  const anchor = matchedTokens.length > 0 ? record.text.toLowerCase().indexOf(matchedTokens[0] ?? "") : -1;
  if (anchor < 0) {
    return record.text.length > EXCERPT_CHARS ? `${record.text.slice(0, EXCERPT_CHARS)}…` : record.text;
  }

  // Centre the window on the match, then move its edges to word boundaries so the excerpt does not
  // start or end mid-word.
  const half = Math.floor((EXCERPT_CHARS - (matchedTokens[0]?.length ?? 0)) / 2);
  let start = Math.max(0, anchor - half);
  const end = Math.min(record.text.length, start + EXCERPT_CHARS);
  start = Math.max(0, end - EXCERPT_CHARS);

  const head = record.text.slice(start, end);
  const from = start > 0 ? head.indexOf(" ") : -1;
  const lead = from > 0 ? head.slice(from + 1) : head;
  const space = lead.lastIndexOf(" ");
  const tail = end < record.text.length && space > 0 ? lead.slice(0, space) : lead;

  return `${start > 0 ? "…" : ""}${tail}${end < record.text.length ? "…" : ""}`;
}
