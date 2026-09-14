/**
 * Composer resolution — the shared engine every composer adapter delegates to (G8.2, G8.7).
 *
 * The order here is the whole design, and it is the same order `extractConversation` uses because
 * the two share a failure mode: a plausible wrong answer. Resolution therefore goes
 *
 *   1. landmark pre-check → refusal before anything else happens,
 *   2. slot ladders in order → first rung that matches,
 *   3. containment → the input must live inside the root,
 *   4. writability → a node that cannot take text is refused, not attempted.
 *
 * Ambiguity is refused rather than resolved. `querySelectorAll` returning two nodes means the page
 * changed shape in a way this ladder does not describe; taking `[0]` would place the user's context
 * into whichever box the document happens to order first, and the user would only find out by
 * looking. A refusal names the slot and the rung, which is what makes the drift fixable.
 */

import { COMPOSER_SLOTS } from "./types.js";
import type {
  ComposerAdapter,
  ComposerSlot,
  ComposerTarget,
  ComposerResolution,
  WriteKind,
} from "./types.js";

/**
 * Which property a node takes text through, or `undefined` when it takes none.
 *
 * The check is attribute-based rather than `instanceof`-based on purpose: this code runs in a page
 * whose own `HTMLElement` constructors are the page's, and the tag/attribute test is the same test
 * the browser's parser used to build the node.
 *
 * `isContentEditable` is deliberately not consulted: it is computed from ancestors and the editing
 * host, so it is `true` for a child of an editable region that will not itself accept the write.
 * Testing the attribute on the node itself is the narrower, more honest question.
 */
export function writeKindOf(node: Element): WriteKind | undefined {
  const tag = node.tagName.toLowerCase();
  if (tag === "textarea" || tag === "input") return "value";

  const editable = node.getAttribute("contenteditable");
  if (editable === null) return undefined;
  return editable === "false" ? undefined : "text";
}

function isWritable(node: Element, kind: WriteKind): boolean {
  if (kind === "text") return true;

  // `readOnly` and `disabled` exist on both form controls this ladder can resolve to, and both mean
  // the browser will discard what is written. Checking them here turns a silent no-op into a refusal.
  const control = node as { readOnly?: boolean; disabled?: boolean };
  return control.readOnly !== true && control.disabled !== true;
}

type SlotOutcome =
  | { readonly ok: true; readonly node: Element; readonly rung: number }
  | { readonly ok: false; readonly detail: string; readonly rung: number };

function resolveSlot(document: Document, ladder: readonly string[]): SlotOutcome {
  for (let rung = 0; rung < ladder.length; rung += 1) {
    const selector = ladder[rung] as string;
    const nodes = document.querySelectorAll(selector);

    if (nodes.length === 0) continue;
    if (nodes.length > 1) {
      return { ok: false, rung, detail: `rung ${rung} (${selector}) matched ${nodes.length} nodes` };
    }
    return { ok: true, node: nodes[0] as Element, rung };
  }

  return { ok: false, rung: -1, detail: "no rung matched" };
}

/**
 * Resolve the composer for one adapter, or refuse with a code that names what was missing.
 *
 * The returned target holds the live element, so this is a page-only function; nothing from it is
 * ever sent over a message channel. What crosses that channel is the `rungs` record, which is a
 * plain object of numbers.
 */
export function resolveComposer(adapter: ComposerAdapter, document: Document): ComposerResolution {
  // 1. Landmark pre-check. Before any rung, any read and any write.
  const hasLandmark = adapter.landmarks.some((landmark) => document.querySelector(landmark) !== null);
  if (!hasLandmark) {
    return {
      ok: false,
      code: "DOM_SHAPE_UNRECOGNIZED",
      detail: `no declared landmark is present (${adapter.landmarks.join(", ")})`,
      slot: "composerRoot",
      rung: -1,
    };
  }

  const rungs: Partial<Record<ComposerSlot, number>> = {};
  const nodes: Partial<Record<ComposerSlot, Element>> = {};

  for (const slot of COMPOSER_SLOTS) {
    const outcome = resolveSlot(document, adapter.ladders[slot]);

    if (!outcome.ok) {
      return {
        ok: false,
        // No rung matching at all is the same shape failure the landmark check reports; a rung that
        // matched too much is its own code, because the fix is different (narrow the ladder).
        code: outcome.rung === -1 ? "DOM_SHAPE_UNRECOGNIZED" : "COMPOSER_AMBIGUOUS",
        detail: `slot ${slot}: ${outcome.detail}`,
        slot,
        rung: outcome.rung,
      };
    }

    rungs[slot] = outcome.rung;
    nodes[slot] = outcome.node;
  }

  const root = nodes.composerRoot as Element;
  const input = nodes.composerInput as Element;

  // 3. Containment. A ladder can match a generic selector (`[contenteditable]`, `textarea`) on a
  // node that has nothing to do with the conversation — this is the check that keeps the write in
  // the composer the user can see.
  if (!root.contains(input)) {
    return {
      ok: false,
      code: "DOM_SHAPE_UNRECOGNIZED",
      detail: "the resolved composer input is not inside the resolved composer root",
      slot: "composerInput",
      rung: rungs.composerInput,
    };
  }

  // 4. Writability.
  const kind = writeKindOf(input);
  if (kind === undefined) {
    return {
      ok: false,
      code: "COMPOSER_NOT_WRITABLE",
      detail: "the resolved composer input is neither a form control nor an editable element",
      slot: "composerInput",
      rung: rungs.composerInput,
    };
  }
  if (!isWritable(input, kind)) {
    return {
      ok: false,
      code: "COMPOSER_NOT_WRITABLE",
      detail: "the resolved composer input is disabled or read-only",
      slot: "composerInput",
      rung: rungs.composerInput,
    };
  }

  const target: ComposerTarget = {
    adapterId: adapter.id,
    node: input,
    kind,
    rungs: { composerRoot: rungs.composerRoot as number, composerInput: rungs.composerInput as number },
  };
  return { ok: true, target };
}
