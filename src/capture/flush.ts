/**
 * The worker→page capture-flush message — the page's end of "Capture this conversation".
 *
 * It is declared here rather than in `src/types/index.ts` for the same reason the placement request
 * is: no popup, options page or side panel ever sees it. The only participants are the service worker
 * and the content script, and the content script is a bundle that must not pull in the surface
 * contract. `tests/quality/content-bundle.spec.ts` pins how small that bundle has to stay.
 *
 * Why the page answers with a raw `ExtractResult` instead of running anything itself: normalization
 * and validation belong to the worker (G2.10). A page that normalized its own capture would be a page
 * that could skip validating it, and the pipeline's guarantee that the transport is never called with
 * an invalid event would then hold only for the captures that came through the passive path.
 *
 * Why the reply separates `unsupported` from `failed`: they need different words. "This is not one of
 * the sites HipCortex reads" is a fact about the page the user is on and no amount of clicking will
 * change it. "The runtime did not acknowledge it" is a fact about the machine, and retrying is the
 * right response. Collapsing them into one message is how a user ends up refreshing a page that was
 * never going to work.
 */

import type { ExtractErrorCode, ExtractResult } from "./providers/types.js";

/** The request kind. A literal type, so a typo is a compile error rather than a silent no-answer. */
export const FLUSH_CAPTURE_REQUEST = "FLUSH_CAPTURE" as const;

export interface FlushCaptureRequest {
  readonly type: typeof FLUSH_CAPTURE_REQUEST;
}

/**
 * What the page did, in three states rather than two.
 *
 * `unsupported` carries no `providerId`, because there is no adapter to name — the page is simply not
 * one this extension reads. `failed` carries both the adapter and the typed code, so the reason the
 * DOM could not be read survives all the way to the surface that has to show it. Neither is an
 * exception, which is the point: a manual capture must never be a button that appears to do nothing.
 */
export type FlushCaptureReply =
  | {
      readonly status: "captured";
      readonly providerId: string;
      readonly url: string;
      readonly result: ExtractResult;
    }
  | {
      readonly status: "failed";
      readonly providerId: string;
      readonly url: string;
      readonly code: ExtractErrorCode;
      readonly detail: string;
    }
  | { readonly status: "unsupported"; readonly url: string };

export function isFlushCaptureRequest(message: unknown): message is FlushCaptureRequest {
  if (typeof message !== "object" || message === null) return false;
  return (message as { type?: unknown }).type === FLUSH_CAPTURE_REQUEST;
}
