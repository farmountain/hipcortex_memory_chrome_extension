/**
 * The worker→page placement message.
 *
 * It is declared here rather than in `src/types/index.ts` because it is not part of the surface
 * contract: no popup, options page or side panel ever sees it. The only participants are the service
 * worker and the content script, and the content script is a bundle that must not pull in the
 * settings shapes. Declaring the request next to the code that answers it keeps the shipped bundle
 * dependent on this file and its types, and nothing else from the surface side.
 *
 * The text travels in the message on purpose. The worker reads the acknowledged record from the
 * index and hands the page a plain string; the page holds no storage access at all, which is what
 * `tests/quality/content-bundle.spec.ts` enforces (no extension-storage read may appear in the
 * bundle).
 * The record's identity is the worker's business; the page never sees an id it could act on.
 */

import type { PlaceContextReport } from "../types/index.js";

/** The request kind. A literal type, so a typo is a compile error rather than a silent no-answer. */
export const PLACE_CONTEXT_REQUEST = "PLACE_CONTEXT_REQUEST" as const;

export interface PlaceContextRequest {
  readonly type: typeof PLACE_CONTEXT_REQUEST;
  /** The text to place, already read from the record the core acknowledged. */
  readonly text: string;
  /** The provider the text was captured from, echoed into the report. */
  readonly sourceProvider?: string;
}

/**
 * The page's answer.
 *
 * `ok` mirrors the report's `placed`: the worker needs a truth value it can turn into a
 * `MessageResponse`, and the report itself is passed through untouched because every field in it is
 * something a surface may show.
 */
export interface PlaceContextReply {
  readonly ok: boolean;
  readonly report: PlaceContextReport;
}

export function isPlaceContextRequest(message: unknown): message is PlaceContextRequest {
  if (typeof message !== "object" || message === null) return false;
  const candidate = message as { type?: unknown; text?: unknown };
  return candidate.type === PLACE_CONTEXT_REQUEST && typeof candidate.text === "string";
}
