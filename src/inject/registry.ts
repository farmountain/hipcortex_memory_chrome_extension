/**
 * The composer registry — the one list of composer adapters.
 *
 * It is a separate list from `src/capture/providers/registry.ts`, not a filtered view of it, and the
 * reason is the failure mode: an adapter added for capture would otherwise silently become an
 * adapter that can write, and a write path that grows by accident is exactly what the separation is
 * for. One entry per provider, same `id` values as the capture registry so the two trees agree about
 * what a provider *is* without sharing a selector.
 */

import { chatgptComposer } from "./composers/chatgpt.js";
import { claudeComposer } from "./composers/claude.js";
import { deepseekComposer } from "./composers/deepseek.js";
import { geminiComposer } from "./composers/gemini.js";
import { grokComposer } from "./composers/grok.js";
import type { ComposerAdapter } from "./types.js";

/** Every composer adapter, in the same order the capture registry lists the providers. */
export const COMPOSERS: readonly ComposerAdapter[] = [
  chatgptComposer,
  claudeComposer,
  geminiComposer,
  grokComposer,
  deepseekComposer,
];

export function allComposers(): readonly ComposerAdapter[] {
  return COMPOSERS;
}

export function composerById(id: string): ComposerAdapter | undefined {
  return COMPOSERS.find((adapter) => adapter.id === id);
}

export function composerByUrl(url: string): ComposerAdapter | undefined {
  return COMPOSERS.find((adapter) => adapter.matches(url));
}
