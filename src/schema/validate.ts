/**
 * Structural validation of a capture event.
 *
 * Two properties matter more than completeness:
 *
 * 1. **It never throws.** Every input — `null`, a string, an object missing whole sections — yields
 *    a result. Validation that throws pushes error handling into every caller, and the caller that
 *    forgets hands an unvalidated event to the transport.
 * 2. **It reports nothing but paths and codes.** The result is a diagnostic. It must be impossible
 *    for a rejection to be logged together with the transcript it rejected (G2.10), and the only
 *    way to guarantee that is for the result to have nowhere to put text.
 *
 * The error codes are derived from `VALIDATION_ERROR_CODES`, so the type cannot drift from the set
 * of codes this function actually emits.
 */

import { MESSAGE_ROLES } from "./conversation.js";
import { isSupportedSchemaVersion } from "./version.js";

export const VALIDATION_ERROR_CODES = [
  "REQUIRED",
  "INVALID_TIMESTAMP",
  "UNSUPPORTED_VERSION",
  "EMPTY_CONVERSATION",
] as const;

export type ValidationErrorCode = (typeof VALIDATION_ERROR_CODES)[number];

export interface ValidationError {
  /** Dotted/bracketed location, e.g. `conversation.messages[2].role`. `$` is the root. */
  readonly path: string;
  readonly code: ValidationErrorCode;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

const ROOT = "$";

/**
 * ISO-8601 UTC **with a `Z` suffix** — and nothing else.
 *
 * A local time and an offset time are both rejected even though `Date.parse` accepts them, because
 * accepting either means two captures from the same conversation can order differently depending on
 * the machine that made them. `Z` or nothing.
 */
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isUtcTimestamp(value: unknown): boolean {
  return isNonEmptyString(value) && UTC_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

type Reporter = (path: string, code: ValidationErrorCode) => void;

function validateMessage(message: unknown, index: number, report: Reporter): void {
  const at = `conversation.messages[${index}]`;

  if (!isRecord(message)) {
    report(at, "REQUIRED");
    return;
  }

  // Contiguity is reported as REQUIRED rather than a dedicated code on purpose: the four codes are
  // the contract's vocabulary for "something structurally necessary is missing", and a wrong index
  // is exactly that. Inventing a fifth code would force the core to learn it.
  if (message["index"] !== index) {
    report(`${at}.index`, "REQUIRED");
  }

  const role = message["role"];
  if (typeof role !== "string" || !(MESSAGE_ROLES as readonly string[]).includes(role)) {
    report(`${at}.role`, "REQUIRED");
  }

  const text = message["text"];
  const attachments = message["attachments"];
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

  // Content rule: text, or at least one attachment. An image-only prompt legitimately has no text;
  // a message with neither is a silently empty capture, which is the failure mode this contract
  // exists to prevent (G8.7).
  if (typeof text !== "string" || (text.trim().length === 0 && !hasAttachments)) {
    report(`${at}.text`, "REQUIRED");
  }
}

export function validateCaptureEvent(value: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const report: Reporter = (path, code) => {
    errors.push({ path, code });
  };

  if (!isRecord(value)) {
    report(ROOT, "REQUIRED");
    return { valid: false, errors };
  }

  if (!isNonEmptyString(value["eventId"])) {
    report("eventId", "REQUIRED");
  }

  const provenance = value["provenance"];
  if (!isRecord(provenance)) {
    report("provenance", "REQUIRED");
  } else {
    const schemaVersion = provenance["schemaVersion"];
    if (typeof schemaVersion !== "number") {
      report("provenance.schemaVersion", "REQUIRED");
    } else if (!isSupportedSchemaVersion(schemaVersion)) {
      report("provenance.schemaVersion", "UNSUPPORTED_VERSION");
    }

    if (!isNonEmptyString(provenance["provider"])) {
      report("provenance.provider", "REQUIRED");
    }
    if (!isNonEmptyString(provenance["adapterVersion"])) {
      report("provenance.adapterVersion", "REQUIRED");
    }
    if (!isNonEmptyString(provenance["source"])) {
      report("provenance.source", "REQUIRED");
    }
    if (!isNonEmptyString(provenance["conversationUrl"])) {
      report("provenance.conversationUrl", "REQUIRED");
    }

    const capturedAt = provenance["capturedAt"];
    if (!isNonEmptyString(capturedAt)) {
      report("provenance.capturedAt", "REQUIRED");
    } else if (!isUtcTimestamp(capturedAt)) {
      report("provenance.capturedAt", "INVALID_TIMESTAMP");
    }
  }

  const conversation = value["conversation"];
  if (!isRecord(conversation)) {
    report("conversation", "REQUIRED");
  } else {
    if (!isNonEmptyString(conversation["url"])) {
      report("conversation.url", "REQUIRED");
    }

    const messages = conversation["messages"];
    if (!Array.isArray(messages)) {
      report("conversation.messages", "REQUIRED");
    } else if (messages.length === 0) {
      report("conversation.messages", "EMPTY_CONVERSATION");
    } else {
      messages.forEach((message, index) => validateMessage(message, index, report));
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Render a validation result as `path: CODE` pairs.
 *
 * This is the *only* supported way to turn a rejection into something storable. It cannot leak
 * transcript text because its input cannot contain any (G2.10).
 */
export function describeValidationFailure(errors: readonly ValidationError[]): string {
  if (errors.length === 0) return "no errors";
  return errors.map((error) => `${error.path}: ${error.code}`).join("; ");
}
