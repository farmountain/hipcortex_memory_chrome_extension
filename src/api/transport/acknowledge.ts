/**
 * The acknowledgement rule, implemented **once**, for both transports.
 *
 * `docs/PROTOCOL.md` §5: a delivery is acknowledged only when the body parses to `success === true`
 * **and** carries a non-empty `record_id`.
 *
 * Why a shared function and not a method on each transport: §9 records that the Native Messaging
 * envelope is *assumed*. If both transports each interpreted the reply, correcting the assumption
 * would mean two edits and two chances to get it wrong. Here, a wrong assumption produces "the
 * entry stays unacknowledged" — the safe direction — in both transports simultaneously.
 *
 * The `warning` array is the runtime's duplicate advisory. It does **not** fail the delivery, and
 * its `target` member (which contains transcript text) is dropped rather than stored (G2.10).
 */

import type { DuplicateWarning, SendFailureKind, SendResult, TransportName } from "./types.js";
import { isRecord } from "./types.js";

/**
 * How much of the runtime's refusal text is kept.
 *
 * Capped because the value comes from outside and reaches `chrome.storage.local`; capped *visibly*
 * because a truncation the user cannot see is the failure mode this whole change exists to remove.
 */
const MAX_REFUSAL_REASON = 500;

/**
 * The runtime's own words, or `null`.
 *
 * Verbatim on purpose. For the PII precondition the reason is
 * `precondition blocked: PII risk=0.90 patterns=["PII:415-555-0134"]` — which quotes the user's own
 * text back. That is not a new exposure: the queue already holds the whole capture this message is
 * about, in the same `chrome.storage.local`, and the alternative — trimming the reason to a code —
 * would be the perception layer deciding what part of a refusal a user is allowed to read
 * (`cortexbridge-retention-boundary` task 5.4).
 */
export function refusalReasonOf(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const error = payload["error"];
  if (typeof error !== "string") return null;
  const trimmed = error.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > MAX_REFUSAL_REASON
    ? `${trimmed.slice(0, MAX_REFUSAL_REASON)}…`
    : trimmed;
}

/**
 * Classify an HTTP status by whether repeating it could succeed.
 *
 * 4xx is the runtime judging *this record*, and the same record will get the same answer. The two
 * exceptions are 408 and 429, which are about the moment rather than the record, and 5xx, which is
 * the runtime being unable to answer at all.
 */
export function classifyHttpStatus(status: number): SendFailureKind {
  if (status === 408 || status === 429) return "transient";
  return status >= 400 && status < 500 ? "refused" : "transient";
}

function toWarnings(value: unknown): DuplicateWarning[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => {
    const warning: { action?: string; id?: string; overlapRatio?: number } = {};
    if (typeof entry["action"] === "string") warning.action = entry["action"];
    if (typeof entry["id"] === "string") warning.id = entry["id"];
    if (typeof entry["overlap_ratio"] === "number") warning.overlapRatio = entry["overlap_ratio"];
    return warning;
  });
}

/**
 * Interpret a capture reply.
 *
 * `context` names what was tried, so the failure detail is actionable without the caller having to
 * reconstruct it.
 */
export function interpretAcknowledgement(
  payload: unknown,
  transport: TransportName,
  context: string
): SendResult {
  if (!isRecord(payload)) {
    return {
      acknowledged: false,
      transport,
      reason: "MALFORMED_RESPONSE",
      detail: `${context}: reply was not a JSON object`,
      kind: "transient",
      refusalReason: null,
    };
  }

  const warning = toWarnings(payload["warning"]);

  if (payload["success"] !== true) {
    // `success: false` is the runtime deciding, not the connection failing: the record was read and
    // judged. So it is a refusal, and it carries the runtime's own explanation when there is one.
    const refusalReason = refusalReasonOf(payload);
    return {
      acknowledged: false,
      transport,
      reason: "NOT_ACKNOWLEDGED",
      detail: refusalReason
        ? `${context}: the runtime refused the record - ${refusalReason}`
        : `${context}: reply did not report success`,
      kind: "refused",
      refusalReason,
    };
  }

  const recordId = payload["record_id"];
  if (typeof recordId !== "string" || recordId.trim().length === 0) {
    return {
      acknowledged: false,
      transport,
      reason: "NOT_ACKNOWLEDGED",
      detail: `${context}: reply carried success but no record_id`,
      // Not a refusal: the runtime claimed success and the envelope was wrong. Repeating it is the
      // only honest response, because nothing about the record has been judged (G2.9).
      kind: "transient",
      refusalReason: null,
    };
  }

  return { acknowledged: true, transport, recordId, warning };
}
