/**
 * The Claude adapter.
 *
 * Like every adapter here, the ladders below are *hypotheses about a page nobody in this repository
 * controls*. `verifiedAt` is the only claim of freshness, and the specs prove the failure mode
 * rather than the selectors: when no rung matches, extraction refuses with a typed error instead of
 * producing a plausible wrong capture.
 *
 * The weakest link is `roleSignal`. Claude identifies a turn's author by the shape of the turn
 * itself rather than by a role attribute, and this extractor only accepts an attribute or a short
 * text token. The rungs below are therefore an explicit hypothesis; if Claude's real markup differs,
 * the first symptom is `NO_ROLE_SIGNAL` on every capture, which is loud by design. A silent wrong
 * capture is the outcome this file exists to avoid.
 */

import { extractConversation } from "../extract.js";
import type { ExtractInput, ExtractResult, ProviderAdapter } from "./types.js";

/** Hosts that serve the Claude conversation surface. */
export const CLAUDE_HOSTS = ["claude.ai"] as const;

/**
 * A conversation URL path: `/chat/<id>`. The bare host is the marketing page and `/settings` is not
 * a conversation, so neither is claimed — matching them would make the adapter fire on every visit
 * to the site and fail extraction each time.
 */
const CONVERSATION_PATH = /^\/chat\/[^/]+/;

function isClaudeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return CLAUDE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

export const claudeAdapter: ProviderAdapter = {
  id: "claude",
  displayName: "Claude",
  adapterVersion: "1.0.0",
  verifiedAt: "2026-09-13",

  /**
   * The app shell and the composer. Both must exist before a single character of message text is
   * read: a signed-out redirect and a conversation still loading render *something*, and the
   * landmark check is what separates "the conversation view" from "a page that happens to have a
   * `<div>` in it".
   */
  landmarks: ["main", '[contenteditable="true"]'],

  ladders: {
    conversationRoot: ['div[data-testid="conversation"]', "main"],
    turnContainer: ['div[data-testid="conversation-turn"]', "[data-turn]"],
    // Assistant text is rendered as prose; a user turn is carried by its own test id. Two rungs, so
    // an assistant turn reports rung 0 and a user turn reports rung 1 — `rungs.messageText` is the
    // deepest rung any turn needed, not a single index for the conversation.
    messageText: [".font-claude-message", '[data-testid="user-message"]'],
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
    return isClaudeHost(parsed.hostname) && CONVERSATION_PATH.test(parsed.pathname);
  },

  extract(input: ExtractInput): ExtractResult {
    return extractConversation(claudeAdapter, input);
  },
};
