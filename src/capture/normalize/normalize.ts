/**
 * Normalization — turn a perceived conversation into a validated `CaptureEvent`.
 *
 * This is the seam where perception stops being "what the page looked like" and becomes "one event
 * the core can retain". Two rules drive the implementation:
 *
 * 1. **The provenance is the adapter's, not this module's.** `extractConversation` already stamped
 *    `provider`, `adapterVersion`, `source`, `conversationUrl` and `capturedAt` from the adapter that
 *    produced the capture (G1.5). Normalization adds the identity of the *event* and nothing else, so
 *    there is no second place for `provider` to be derived and no way for the two to disagree.
 * 2. **Validation is not optional and not a warning.** A failure returns a code and a path list, and
 *    `describeValidationFailure` cannot carry transcript text, so a rejection can be logged without
 *    dragging the user's conversation into a diagnostics store (G2.10).
 *
 * `rungs` is deliberately dropped. It is drift diagnostics — which selector rung resolved a slot —
 * and the event contract has exactly three members. Keeping it would put a debugging artefact into
 * a versioned format that another process consumes.
 */

import { describeValidationFailure, validateCaptureEvent } from "../../schema/index.js";
import type { CaptureEvent, ValidationErrorCode } from "../../schema/index.js";
import type { ExtractSuccess } from "../providers/types.js";

export type NormalizeFailureCode = ValidationErrorCode | "INVALID_EVENT_ID";

export type NormalizeResult =
  | { readonly ok: true; readonly event: CaptureEvent }
  | { readonly ok: false; readonly code: NormalizeFailureCode; readonly detail: string };

/**
 * A fresh event id.
 *
 * `crypto.randomUUID` is available in the service worker and in any context this runs in; an event
 * id is an identity, not a sequence, so two events created in the same millisecond must not collide.
 */
export function newEventId(): string {
  return crypto.randomUUID();
}

/**
 * Build and validate the event for a successful extraction.
 *
 * The event is validated *here* rather than only at the transport, because a caller that skips this
 * step should not find out about it from the runtime's error response — if it finds out at all.
 */
export function normalizeCapture(success: ExtractSuccess, eventId: string): NormalizeResult {
  if (eventId.trim().length === 0) {
    return { ok: false, code: "INVALID_EVENT_ID", detail: "eventId is empty" };
  }

  const event: CaptureEvent = {
    eventId,
    provenance: success.provenance,
    conversation: success.conversation,
  };

  const validation = validateCaptureEvent(event);
  if (!validation.valid) {
    const first = validation.errors[0];
    return {
      ok: false,
      code: first ? first.code : "REQUIRED",
      detail: describeValidationFailure(validation.errors),
    };
  }

  return { ok: true, event };
}
