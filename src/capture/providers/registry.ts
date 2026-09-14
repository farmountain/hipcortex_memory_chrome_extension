/**
 * The provider registry — the single place an adapter is registered.
 *
 * There is exactly one `ADAPTERS` array and no dynamic registration path. That is the mechanism
 * behind G1.1: if a provider is supported, it appears here once, and there is no second list to
 * forget to update — the five adapters below are the whole of the supported surface.
 *
 * `byUrl` returns the first adapter whose `matches()` accepts the URL. First-match rather than
 * best-match is only safe while adapters do not overlap, which is why the registry spec asserts
 * that no URL is claimed twice (G1.1) instead of relying on ordering.
 */

import { chatgptAdapter } from "./chatgpt.js";
import { claudeAdapter } from "./claude.js";
import { deepseekAdapter } from "./deepseek.js";
import { geminiAdapter } from "./gemini.js";
import { grokAdapter } from "./grok.js";
import type { ProviderAdapter } from "./types.js";

const ADAPTERS: readonly ProviderAdapter[] = [
  chatgptAdapter,
  claudeAdapter,
  geminiAdapter,
  grokAdapter,
  deepseekAdapter,
];

/** Every registered adapter, in registration order. */
export function allAdapters(): readonly ProviderAdapter[] {
  return ADAPTERS;
}

export function byId(id: string): ProviderAdapter | null {
  return ADAPTERS.find((adapter) => adapter.id === id) ?? null;
}

/** The adapter for a page URL, or `null` when this layer does not support that provider. */
export function byUrl(url: string): ProviderAdapter | null {
  return ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}
