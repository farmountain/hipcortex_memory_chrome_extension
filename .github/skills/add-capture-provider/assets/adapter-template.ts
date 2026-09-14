/**
 * Provider adapter template — copy to `src/capture/providers/<id>.ts`.
 *
 * This file lives under `.github/` and is NOT compiled (tsconfig only includes `src/**`).
 * It is a shape reference, not a build artifact. Replace every TODO.
 *
 * Rules of thumb:
 * - No imports from sibling adapters.
 * - No `fetch`, no cognitive calls — extraction only.
 * - `matches()` must be pure and must not touch the DOM.
 * - Never return a partial conversation as if it were complete.
 *
 * NOTE: the schema import path below assumes the contract lives at repo-root `schema/`.
 * `tsconfig.json` sets `rootDir: "src"`, so that path will not compile until the rootDir
 * decision in Phase B is made. Adjust the import to wherever the contract actually lands.
 */

import type { Conversation } from "../../../schema/conversation.js";
import type { ExtractInput, ExtractResult } from "../types.js";

/** Markup assumption verified on <TODO YYYY-MM-DD> against <TODO provider URL>. */
export const ADAPTER_VERSION = "1.0.0";

const CANONICAL_HOSTS = [
  "TODO.example.com", // TODO: canonical host
  "TODO-subdomain.example.com", // TODO: alternate/subdomain host, if any
];

/**
 * Selector ladder, most-semantic first. Every entry is a hypothesis that a spec must prove.
 * Rank 5 (positional heuristics) is a last resort and must never be the only strategy.
 */
const SELECTORS = {
  messageContainer: [
    "[data-message-author-role]", // rank 1 — semantic attribute
    "[data-testid='TODO']", // rank 2 — test hook
    "TODO main article", // rank 3 — structural landmark
  ],
  role: "[data-message-author-role]",
  text: "TODO",
} as const;

export const adapter = {
  id: "TODO-id", // matches registry key AND tests/fixtures/<id>/
  displayName: "TODO Display Name",
  adapterVersion: ADAPTER_VERSION,

  matches(url: string): boolean {
    try {
      const { hostname, pathname } = new URL(url);
      const hostOk = CANONICAL_HOSTS.some(
        (h) => hostname === h || hostname.endsWith(`.${h}`)
      );
      return hostOk && pathname.startsWith("TODO/"); // TODO: optional path guard
    } catch {
      return false;
    }
  },

  extract(input: ExtractInput): ExtractResult {
    const messageNodes = pick(input.root, SELECTORS.messageContainer);
    if (messageNodes.length === 0) {
      // Typed failure — the caller must NOT forward this to the transport.
      return { ok: false, error: { code: "NO_ROLE_SIGNAL", adapterId: "TODO-id" } };
    }

    const messages = messageNodes
      .map((node) => {
        const role = node.getAttribute("data-message-author-role");
        const text = node.textContent?.trim() ?? "";
        return role && text ? { role: role as "user" | "assistant", text } : null;
      })
      .filter((m): m is { role: "user" | "assistant"; text: string } => m !== null);

    if (messages.length === 0) {
      return { ok: false, error: { code: "EMPTY_CONVERSATION", adapterId: "TODO-id" } };
    }

    return {
      ok: true,
      conversation: {
        schemaVersion: 1, // TODO: import SCHEMA_VERSION — never hardcode in real code
        provider: "TODO-id",
        adapterVersion: ADAPTER_VERSION,
        source: "content-script",
        conversationUrl: input.url,
        capturedAt: new Date().toISOString(), // must be UTC ISO-8601 with Z
        messages,
        attachments: [], // TODO: populate if an attachment was observed
      },
    };
  },
};

/** First selector in the ladder that yields nodes. Keeps brittleness contained here. */
function pick(root: ParentNode, ladder: readonly string[]): HTMLElement[] {
  for (const selector of ladder) {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (found.length > 0) return found;
  }
  return [];
}
