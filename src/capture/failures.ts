/**
 * The capture failure log — diagnostics that cannot become a second copy of the user's data.
 *
 * A record holds **four fields and only four**: `{ timestamp, path, code, providerId }`. That is the
 * whole point of the file (G2.10). Bounding the log is therefore safe: whatever the bound drops is
 * a diagnostic, never content. If a `target` or a transcript ever reached this log, trimming it
 * would destroy memory — and the trim is exactly what a log needs to have.
 *
 * `path` says which stage refused the capture, because those two failures have different fixes:
 * a `validation` refusal means the artifact was not a usable event (a perception or contract
 * problem), a `transport` refusal means a usable event could not be delivered (a delivery problem).
 */

export const FAILURE_LOG_KEY = "hipcortex.capture.failures";

/** Newest-first bound. Small on purpose: this is a debugging aid, not a ledger. */
export const FAILURE_LOG_LIMIT = 50;

export type FailurePath = "validation" | "transport";

export interface FailureRecord {
  readonly timestamp: string;
  readonly path: FailurePath;
  readonly code: string;
  readonly providerId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFailureRecord(value: unknown): value is FailureRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value["timestamp"] === "string" &&
    (value["path"] === "validation" || value["path"] === "transport") &&
    typeof value["code"] === "string" &&
    typeof value["providerId"] === "string" &&
    Object.keys(value).length === 4
  );
}

export async function readFailures(): Promise<readonly FailureRecord[]> {
  const stored = await chrome.storage.local.get(FAILURE_LOG_KEY);
  const value = stored[FAILURE_LOG_KEY];
  if (!Array.isArray(value)) return [];
  // A record that does not have exactly the four fields is dropped rather than repaired: a repaired
  // record could be a place content hides, and dropping it costs a diagnostic.
  return value.filter(isFailureRecord).map((record) => ({
    timestamp: record.timestamp,
    path: record.path,
    code: record.code,
    providerId: record.providerId,
  }));
}

/**
 * Append one diagnosis, newest first, bounded at `FAILURE_LOG_LIMIT`.
 *
 * The object literal below is the only way a record is constructed in this codebase, so the field
 * set cannot grow by accident, and a caller cannot smuggle content in through `...extra`.
 */
export async function recordFailure(record: FailureRecord): Promise<readonly FailureRecord[]> {
  const entry: FailureRecord = {
    timestamp: record.timestamp,
    path: record.path,
    code: record.code,
    providerId: record.providerId,
  };

  const existing = await readFailures();
  const next = [entry, ...existing].slice(0, FAILURE_LOG_LIMIT);
  await chrome.storage.local.set({ [FAILURE_LOG_KEY]: next });
  return next;
}
