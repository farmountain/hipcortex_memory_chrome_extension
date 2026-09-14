/**
 * The composer contract — the writing side of the boundary (G8.2, G8.7).
 *
 * This is a separate contract from `ProviderAdapter`, and the separation is structural rather than
 * stylistic. The capture contract is read-only: every guarantee the repository makes about capturing
 * a conversation rests on that tree never writing to a page. A write path bolted onto the same
 * interface would make "capture does not write" a convention that the next change has to remember,
 * so the write path gets its own interface, its own tree and its own containment scans.
 *
 * What the two contracts share is the provider `id` values (`"chatgpt"`, `"claude"`, ...), because a
 * provider is one thing with two surfaces and `src/capture/providers/registry.ts` is already the one
 * place that identity is defined. Nothing else is shared: a selector added for reading must never
 * silently become a selector used for writing, since the two have opposite failure modes — a missed
 * read produces a refusal, a misaimed write produces text in the wrong box.
 *
 * Three rules are copied from the capture contract on purpose, because they are the rules that make a
 * refusal trustworthy:
 *
 * 1. **A structural landmark is checked before anything else.** If none of the declared landmarks is
 *    in the document, the result is `DOM_SHAPE_UNRECOGNIZED` before a single rung is tried, before
 *    any text is read and before anything is written. A signed-out page or an interstitial fails
 *    here rather than at the write.
 * 2. **A rung that matches more than one node is a refusal, not a choice.** `COMPOSER_AMBIGUOUS` is
 *    the honest answer to "there are two composers here" — picking the first is how text lands in a
 *    box the user was not looking at.
 * 3. **Configuration is code.** Ladders are literals in `src/inject/composers/*.ts`. Nothing is
 *    fetched, nothing is read from storage, nothing is imported dynamically — and
 *    `tests/quality/source-scans.spec.ts` asserts all three over this tree, in both directions: the
 *    selectors must be found here and must appear nowhere else in `src/`.
 */

import type { PlacementRefusalCode } from "../types/index.js";

/**
 * The two slots a composer is resolved from.
 *
 * `composerRoot` is the structural container and `composerInput` is the element that accepts text.
 * The root is not decoration: the input must be **inside** the resolved root, and that containment
 * check is what stops a ladder from resolving to a stray editable element somewhere else on the page
 * (a search box, a rename field) that happens to match the same generic selector.
 */
export const COMPOSER_SLOTS = ["composerRoot", "composerInput"] as const;

export type ComposerSlot = (typeof COMPOSER_SLOTS)[number];

/** One ordered selector list per slot. Rung `n` is `ladder[n]`; the first match wins. */
export type ComposerLadders = Readonly<Record<ComposerSlot, readonly string[]>>;

/** Which property text is written into. A form control takes `value`; an editable takes `text`. */
export type WriteKind = "value" | "text";

/** The rung each slot resolved at, so a page that drifted one rung is visible in the report. */
export type ComposerRungs = Readonly<Record<ComposerSlot, number>>;

export interface ComposerTarget {
  readonly adapterId: string;
  /** The element that will receive the text. Never leaves the page. */
  readonly node: Element;
  readonly kind: WriteKind;
  readonly rungs: ComposerRungs;
}

export interface ComposerFailure {
  readonly ok: false;
  readonly code: PlacementRefusalCode;
  readonly detail: string;
  readonly slot?: ComposerSlot;
  /** The rung that failed, or `-1` when no rung was reached at all. */
  readonly rung?: number;
}

export type ComposerResolution =
  | { readonly ok: true; readonly target: ComposerTarget }
  | ComposerFailure;

export interface ComposerAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly adapterVersion: string;
  /**
   * The date the composer shape was last checked against the live page, `YYYY-MM-DD`.
   *
   * Same meaning as the capture adapters' field, and the same honesty: these ladders are hypotheses
   * about pages nobody in this repository controls. A future date would be an unverified ladder
   * claiming freshness it does not have.
   */
  readonly verifiedAt: string;
  /** Structural elements that must exist for this page to be a composer page at all. */
  readonly landmarks: readonly string[];
  readonly ladders: ComposerLadders;
  matches(url: string): boolean;
  resolve(document: Document): ComposerResolution;
}
