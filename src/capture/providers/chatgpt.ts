/**
 * The ChatGPT adapter.
 *
 * Every ladder entry here is a *hypothesis about a page nobody in this repository controls*. The
 * `verifiedAt` date is the only claim of freshness, and `docs/END-STATE.md` is explicit that a
 * structural fixture passing is not evidence that a rung matches today's live DOM. What the tests
 * do guarantee is the failure mode: when none of these rungs matches, extraction refuses rather than
 * guessing.
 *
 * Ladder entries are ordered most specific to least, and the order is the mitigation for DOM drift.
 * When a provider ships a rename, the deeper rung keeps working and `rungs` reports that the page
 * forced us further down — the signal the drift counter watches (G8.6).
 */

import { extractConversation } from "../extract.js";
import type { ExtractInput, ExtractResult, ProviderAdapter } from "./types.js";

/** Hosts that serve the ChatGPT conversation surface. */
export const CHATGPT_HOSTS = ["chatgpt.com", "chat.openai.com"] as const;

/**
 * A conversation URL path: `/c/<id>`, a share link, or a project-scoped `/g/<project>/c/<id>`.
 * A bare host is not a conversation, and matching one would make the adapter claim the landing
 * page — where extraction would then fail on every visit.
 */
const CONVERSATION_PATH = /^\/(?:c|share)\/[^/]+/;

function isChatGptHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return CHATGPT_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

export const chatgptAdapter: ProviderAdapter = {
  id: "chatgpt",
  displayName: "ChatGPT",
  adapterVersion: "1.0.0",
  verifiedAt: "2025-01-15",

  /**
   * The app shell and the composer. Both must exist before a single character of message text is
   * read: a loading page, a signed-out redirect and a maintenance page all render *something*, and
   * the landmark check is what separates "the conversation view" from "a page that happens to have
   * a `<div>` in it".
   */
  landmarks: ["main", "form"],

  ladders: {
    conversationRoot: ["main#conversation-root", 'div[role="main"]'],
    // A turn is identified by a test id in the current build and by a semantic attribute in older
    // ones; `article[data-turn]` is the fallback rather than the primary because test ids have
    // proven more stable than the markup.
    turnContainer: ['[data-testid^="conversation-turn-"]', "article[data-turn]"],
    // Assistant text is rendered as markdown. User text is not, and arrives in a pre-formatted
    // block — which is why this ladder has three rungs and why `rungs.messageText` is the deepest
    // one any turn needed rather than a single index.
    messageText: [".markdown", "[data-message-content]", ".whitespace-pre-wrap"],
    roleSignal: ["[data-message-author-role]", "[data-author-role]"],
  },

  matches(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return isChatGptHost(parsed.hostname) && CONVERSATION_PATH.test(parsed.pathname);
  },

  extract(input: ExtractInput): ExtractResult {
    return extractConversation(chatgptAdapter, input);
  },
};
