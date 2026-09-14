/**
 * Placement — the one write path in the extension (G4.5).
 *
 * The guarantee this module exists to make is narrow and checkable: **when the user has not turned
 * injection on, no provider page changes, and the extension knows this by comparing the page to
 * itself rather than by trusting its own control flow.** The `enabled` check is therefore the first
 * statement of `placeContext`, before the URL is even parsed, so there is no earlier statement that
 * could touch a document. `tests/capture/injection.spec.ts` serialises a fixture page, calls this
 * function with `enabled: false`, serialises it again and requires byte equality — a stronger claim
 * than any assertion about which branch ran.
 *
 * Four more rules are implemented here:
 *
 * - **Nothing is submitted.** No `click`, no `keydown`, no submit event, no form request. Placing
 *   context is not sending it, and the only way to keep that true is to have no code on this path
 *   that could send anything. The specs record every outbound route this tree could take — the
 *   request call, the transport layer and the native messaging port — and require all of them
 *   untouched, and a source scan requires this tree to contain no network expression at all. That
 *   scan has no comment exemption, which is why this paragraph describes those routes instead of
 *   naming them.
 * - **The user's draft survives.** The existing content is read before the write and written back if
 *   the write does not take, including the case where the page accepted the text and then replaced
 *   it. A failed placement leaves the composer exactly as it was found.
 * - **Truncation is always reported, never silent.** The budget is `INJECTION_MAX_CHARS`; the cut
 *   happens at the last word boundary inside the budget, and the report carries both lengths so a
 *   surface can say what happened. A placed prefix presented as the whole context would be worse
 *   than a refusal, because the user would send it believing it complete.
 * - **Empty is not a write.** A capture whose text is blank after trimming is refused as
 *   `CONTEXT_EMPTY` rather than clearing the user's draft to place nothing.
 */

import { composerByUrl } from "./registry.js";
import type { ComposerTarget, WriteKind } from "./types.js";
import type { PlaceContextReport } from "../types/index.js";

/**
 * The placement budget, in characters.
 *
 * 2000 is not a claim about any provider's limit — reading `maxlength` from the node was rejected
 * precisely because a framework-controlled composer reports no such attribute and the number would
 * then be a guess dressed as a measurement. It is a small, honest, documented budget that a surface
 * can name, and anything longer is reported as truncated.
 */
export const INJECTION_MAX_CHARS = 2000;

export interface PlaceContextInput {
  readonly document: Document;
  readonly url: string;
  /** The user's setting. Checked before anything else, on purpose. */
  readonly enabled: boolean;
  readonly text: string;
  /** The provider the text was captured from, for the report. */
  readonly sourceProvider?: string;
}

function readValue(node: Element, kind: WriteKind): string {
  if (kind === "value") return (node as HTMLTextAreaElement).value;
  return node.textContent ?? "";
}

function writeValue(node: Element, kind: WriteKind, text: string): boolean {
  try {
    if (kind === "value") {
      (node as HTMLTextAreaElement).value = text;
    } else {
      node.textContent = text;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Cut `text` to `maxChars`, preferring the last word boundary inside the budget.
 *
 * The boundary is only taken when it keeps at least half the budget: `text.slice(0, maxChars)` of a
 * string with a single space near the start would otherwise collapse to almost nothing, which is a
 * worse answer than a hard cut. When there is no whitespace at all — a base64 blob, a single long
 * token — the hard cut is the fallback and the report still says `truncated: true`.
 */
export function truncateAtBoundary(
  text: string,
  maxChars: number,
): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };

  const slice = text.slice(0, maxChars);
  const boundary = Math.max(
    slice.lastIndexOf(" "),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf("\t"),
  );

  if (boundary >= maxChars / 2) {
    return { text: slice.slice(0, boundary).trimEnd(), truncated: true };
  }
  return { text: slice, truncated: true };
}

export function placeContext(input: PlaceContextInput): PlaceContextReport {
  // 1. The off state. First, so nothing above it can have touched the page.
  if (!input.enabled) {
    return {
      placed: false,
      code: "INJECTION_DISABLED",
      detail: "placing context into AI chats is turned off in the extension options",
    };
  }

  // 2. Nothing to place. Refused rather than clearing the composer with an empty write.
  if (input.text.trim().length === 0) {
    return { placed: false, code: "CONTEXT_EMPTY", detail: "the selected capture has no text" };
  }

  // 3. Which provider page is this? A URL that is not a provider page is a refusal here, but the
  // worker has already refused earlier for the common case; this arm covers a tab that navigated
  // between the worker's check and this message.
  const adapter = composerByUrl(input.url);
  if (adapter === undefined) {
    return {
      placed: false,
      code: "UNSUPPORTED_PROVIDER",
      detail: "this page is not a supported AI chat",
    };
  }

  // 4. Resolve. Landmarks first, then ladders, then containment and writability.
  const resolution = adapter.resolve(input.document);
  if (!resolution.ok) {
    const rung = resolution.rung;
    const slot = resolution.slot;
    return {
      placed: false,
      code: resolution.code,
      detail: resolution.detail,
      providerId: adapter.id,
      sourceProvider: input.sourceProvider,
      rungs:
        slot !== undefined && rung !== undefined && rung >= 0 ? { [slot]: rung } : undefined,
    };
  }

  // 5. Budget.
  const { text, truncated } = truncateAtBoundary(input.text, INJECTION_MAX_CHARS);

  // 6. The draft, and the write.
  const target: ComposerTarget = resolution.target;
  const draft = readValue(target.node, target.kind);

  if (!writeValue(target.node, target.kind, text)) {
    return {
      placed: false,
      code: "COMPOSER_NOT_WRITABLE",
      detail: "the composer rejected the write; the draft was left unchanged",
      providerId: adapter.id,
      sourceProvider: input.sourceProvider,
      rungs: target.rungs,
    };
  }

  // 7. Read back. A framework that overwrites the node on its next render would otherwise be
  // reported as a successful placement of text that is not there.
  if (readValue(target.node, target.kind) !== text) {
    writeValue(target.node, target.kind, draft);
    return {
      placed: false,
      code: "COMPOSER_NOT_WRITABLE",
      detail: "the page did not keep the placed text; the draft was restored",
      providerId: adapter.id,
      sourceProvider: input.sourceProvider,
      rungs: target.rungs,
    };
  }

  return {
    placed: true,
    providerId: adapter.id,
    sourceProvider: input.sourceProvider,
    placedChars: text.length,
    sourceChars: input.text.length,
    truncated,
    maxChars: INJECTION_MAX_CHARS,
    wroteInto: target.kind,
    rungs: target.rungs,
  };
}
