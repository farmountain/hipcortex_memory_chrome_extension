/**
 * The capture pipeline — the one ordering of steps that decides what happens to a captured
 * conversation, and the one place where an invalid event is stopped.
 *
 * ```
 *   inert gate ─▶ refusal?   ─▶ record diagnosis, stop
 *                        │
 *                        └▶ normalize + validate ─▶ invalid? ─▶ record diagnosis, stop
 *                                                                  (the transport is never called)
 *                        └▶ send ─▶ acknowledged? ─▶ clear drift, drain, done
 *                                      │
 *                                      └▶ no ─▶ enqueue (or report the paused state), never discard
 * ```
 *
 * Why the ordering is the implementation and not an implementation detail:
 *
 * - **Validation runs before the transport.** A pipeline that sends first and validates afterwards
 *   has a window where a malformed event is already in the core, and it cannot be removed from there
 *   (G2.10).
 * - **`autoCapture` gates the *trigger*, not the queue.** The passive path is inert when the setting
 *   is false, but a manual capture still works, and the queue drains regardless of the flag —
 *   otherwise toggling a setting mid-flight would strand captures that were already accepted (G1.7,
 *   G7.5).
 * - **Extraction failures increment the drift counter** because they are typed DOM failures. A
 *   *validation* failure does not: an event that came out of the adapter but not out of the event
 *   contract is a bug in the contract or the normalizer, and blaming the provider's DOM for it would
 *   send someone looking at the wrong page.
 */

import { toEgressRecord } from "../schema/index.js";
import type { CaptureEvent } from "../schema/index.js";
import type { SendFailureReason, Transport } from "../api/transport/index.js";
import { normalizeCapture, newEventId } from "./normalize/normalize.js";
import type { NormalizeFailureCode } from "./normalize/normalize.js";
import { enqueueEvent, pauseMessage } from "./queue/queue.js";
import { recordAcknowledgedCapture } from "../index/local.js";
import { recordFailure } from "./failures.js";
import { recordDriftFailure, recordDriftSuccess } from "./drift.js";
import type { ExtractErrorCode, ExtractResult } from "./providers/types.js";

/** `passive` is the content script's observation of a page; `manual` is a user-requested capture. */
export type CaptureTrigger = "passive" | "manual";

/**
 * The pipeline refuses at two stages, so a rejection carries either family of code.
 *
 * `ExtractErrorCode` means perception could not read the page (a DOM problem, and the codes the
 * drift counter counts). `NormalizeFailureCode` means perception read it and the *event contract*
 * refused the result, which is this repository's bug rather than the provider's page.
 */
export type RejectionCode = ExtractErrorCode | NormalizeFailureCode;

export interface CaptureRequest {
  /** The adapter that produced `result`. Only the caller knows it, and only failures need it. */
  readonly providerId: string;
  readonly result: ExtractResult;
  readonly trigger: CaptureTrigger;
}

export interface PipelineDeps {
  readonly transport: Transport;
  readonly actor: string;
  readonly autoCapture: boolean;
  readonly now?: () => Date;
  readonly eventId?: () => string;
  /** Runs after a delivered capture, when the runtime has just proved it is reachable (G2.6). */
  readonly onDelivered?: () => Promise<void>;
}

export type PipelineOutcome =
  | { readonly status: "delivered"; readonly eventId: string; readonly recordId: string }
  | { readonly status: "queued"; readonly eventId: string; readonly reason: SendFailureReason }
  | { readonly status: "paused"; readonly unacknowledged: number; readonly message: string }
  | { readonly status: "rejected"; readonly code: RejectionCode; readonly detail: string }
  | { readonly status: "inert"; readonly reason: "auto-capture-disabled" };

/** True when this request must not run: passive observation with auto-capture switched off. */
export function isInert(request: CaptureRequest, autoCapture: boolean): boolean {
  return request.trigger === "passive" && !autoCapture;
}

async function diagnose(
  providerId: string,
  path: "validation" | "transport",
  code: string,
  now: Date
): Promise<void> {
  await recordFailure({
    timestamp: now.toISOString(),
    path,
    code,
    providerId,
  });
}

export async function runCapturePipeline(
  request: CaptureRequest,
  deps: PipelineDeps
): Promise<PipelineOutcome> {
  const now = deps.now?.() ?? new Date();

  if (isInert(request, deps.autoCapture)) {
    return { status: "inert", reason: "auto-capture-disabled" };
  }

  const result = request.result;

  if (!result.ok) {
    // Perception refused the page. Typed, content-free, and the strongest drift signal there is.
    await diagnose(request.providerId, "validation", result.code, now);
    await recordDriftFailure(
      { providerId: request.providerId, code: result.code, slot: result.slot, rung: result.rung },
      now
    );
    return { status: "rejected", code: result.code, detail: result.detail };
  }

  const eventId = (deps.eventId ?? newEventId)();
  const normalized = normalizeCapture(result, eventId);

  if (!normalized.ok) {
    await diagnose(request.providerId, "validation", normalized.code, now);
    return { status: "rejected", code: normalized.code, detail: normalized.detail };
  }

  const event: CaptureEvent = normalized.event;
  const sent = await deps.transport.addMemory(toEgressRecord(event, deps.actor));

  if (sent.acknowledged) {
    // The one moment this capture is known to exist in the core, so the only moment it may be
    // searchable offline (G3.9, task 1.3). Nothing about the outcome depends on this write: the
    // index is a cache, and a storage failure here is reported by the index itself rather than
    // turning an acknowledged capture into a failed one.
    await recordAcknowledgedCapture(event, sent.recordId, deps.actor);
    await recordDriftSuccess(event.provenance.provider);
    if (deps.onDelivered) await deps.onDelivered();
    return { status: "delivered", eventId, recordId: sent.recordId };
  }

  await diagnose(event.provenance.provider, "transport", sent.reason, now);

  const queued = await enqueueEvent(event, now);
  if (!queued.accepted) {
    return {
      status: "paused",
      unacknowledged: queued.state.entries.length,
      message: queued.message ?? pauseMessage(queued.state.entries.length),
    };
  }

  return { status: "queued", eventId, reason: sent.reason };
}
