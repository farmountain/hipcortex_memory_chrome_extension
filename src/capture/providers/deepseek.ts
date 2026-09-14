/**
 * The DeepSeek adapter.
 *
 * The ladders are hypotheses about a page nobody in this repository controls; the specs prove the
 * failure mode rather than the selectors. DeepSeek's build hashes its class names, so the user-turn
 * rung names a hashed class: that is the most brittle selector in this file on purpose. When it is
 * renamed, that turn resolves through no rung and the capture fails with `MESSAGE_COUNT_MISMATCH`
 * instead of quietly dropping a turn — the drift counter is what turns that into an adapter update.
 *
 * As in every adapter, `roleSignal` is the least-evidenced slot: this extractor only accepts a role
 * attribute or a short text token, so the rungs below are an explicit hypothesis whose failure mode
 * is `NO_ROLE_SIGNAL` rather than a plausible wrong capture.
 */

import { extractConversation } from "../extract.js";
import type { ExtractInput, ExtractResult, ProviderAdapter } from "./types.js";

/**
 * The host that serves the DeepSeek conversation surface. The bare `deepseek.com` domain is the
 * marketing site, and declaring it here would ask the user for access to it for no reason.
 */
export const DEEPSEEK_HOSTS = ["chat.deepseek.com"] as const;

/**
 * A conversation URL path: `/a/chat/s/<id>`. The app shell itself is not a conversation, so it is
 * not claimed — matching it would fire the adapter on every visit and fail extraction.
 */
const CONVERSATION_PATH = /^\/a\/chat\/s\/[^/]+/;

function isDeepSeekHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return DEEPSEEK_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

export const deepseekAdapter: ProviderAdapter = {
  id: "deepseek",
  displayName: "DeepSeek",
  adapterVersion: "1.0.0",
  verifiedAt: "2026-09-13",

  /**
   * The app shell and the composer, checked before any message text is read — so a page that is
   * still booting fails as an unrecognised shape rather than yielding an empty conversation.
   */
  landmarks: ["main", "textarea"],

  ladders: {
    conversationRoot: ['div[data-testid="conversation"]', "main"],
    turnContainer: ['div[data-testid="conversation-turn"]', "[data-turn]"],
    // A response arrives through the provider's markdown renderer; a user turn is carried by its
    // bubble. Two rungs, so `rungs.messageText` reports the deepest rung any turn needed.
    messageText: [".ds-markdown", ".fbb737a4"],
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
    return isDeepSeekHost(parsed.hostname) && CONVERSATION_PATH.test(parsed.pathname);
  },

  extract(input: ExtractInput): ExtractResult {
    return extractConversation(deepseekAdapter, input);
  },
};
