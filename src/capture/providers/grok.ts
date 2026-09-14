/**
 * The Grok adapter.
 *
 * The ladders are hypotheses about a page nobody in this repository controls; the specs prove the
 * failure mode rather than the selectors. Grok's conversation surface shares its rendering with the
 * social client it grew out of, which is why the message-text rungs name a markdown container and a
 * bubble class rather than a test id: bubble classes have outlived test ids on that surface.
 *
 * As in every adapter, `roleSignal` is the least-evidenced slot: this extractor only accepts a role
 * attribute or a short text token, so the rungs below are an explicit hypothesis whose failure mode
 * is `NO_ROLE_SIGNAL` rather than a plausible wrong capture.
 */

import { extractConversation } from "../extract.js";
import type { ExtractInput, ExtractResult, ProviderAdapter } from "./types.js";

/** Hosts that serve the Grok conversation surface. */
export const GROK_HOSTS = ["grok.com"] as const;

/**
 * A conversation URL path: `/chat/<id>`. The bare host is the composer with no conversation open,
 * so it is not claimed — matching it would fire the adapter on every visit and fail extraction.
 */
const CONVERSATION_PATH = /^\/chat\/[^/]+/;

function isGrokHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return GROK_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

export const grokAdapter: ProviderAdapter = {
  id: "grok",
  displayName: "Grok",
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
    // A response arrives as rendered markdown; a user turn is carried by its bubble. Two rungs, so
    // `rungs.messageText` reports the deepest rung any turn in the conversation needed.
    messageText: [".response-content-markdown", ".message-bubble"],
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
    return isGrokHost(parsed.hostname) && CONVERSATION_PATH.test(parsed.pathname);
  },

  extract(input: ExtractInput): ExtractResult {
    return extractConversation(grokAdapter, input);
  },
};
