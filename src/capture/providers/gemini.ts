/**
 * The Gemini adapter.
 *
 * The ladders are hypotheses about a page nobody in this repository controls; the specs prove the
 * failure mode rather than the selectors. Gemini is the one provider here whose markup is built from
 * custom elements (`<user-query>`, `<model-response>`) rather than test ids, so the turn container
 * ladder starts with element names and falls back to a semantic attribute — if Google renames those
 * elements, the fallback rung keeps the capture alive and `rungs.turnContainer` reports the drift.
 *
 * As in every adapter, `roleSignal` is the least-evidenced slot: this extractor only accepts a role
 * attribute or a short text token, so the rungs below are an explicit hypothesis whose failure mode
 * is `NO_ROLE_SIGNAL` rather than a plausible wrong capture.
 */

import { extractConversation } from "../extract.js";
import type { ExtractInput, ExtractResult, ProviderAdapter } from "./types.js";

/** Hosts that serve the Gemini conversation surface. */
export const GEMINI_HOSTS = ["gemini.google.com"] as const;

/**
 * A conversation URL path: `/app/<id>`. The bare host is the app shell with no conversation open,
 * so it is not claimed — matching it would fire the adapter on every visit and fail extraction.
 */
const CONVERSATION_PATH = /^\/app\/[^/]+/;

function isGeminiHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return GEMINI_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  displayName: "Gemini",
  adapterVersion: "1.0.0",
  verifiedAt: "2026-09-13",

  /**
   * The app shell and the composer, checked before any message text is read — so a page that is
   * still booting fails as an unrecognised shape rather than yielding an empty conversation.
   */
  landmarks: ["main", '[contenteditable="true"]'],

  ladders: {
    conversationRoot: ["conversation-container", "main"],
    turnContainer: ["user-query, model-response", "[data-turn]"],
    // Model responses are rendered as markdown; a user turn is carried by its query block. Two
    // rungs, so `rungs.messageText` reports the deepest rung any turn in the conversation needed.
    messageText: [".markdown", ".query-text"],
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
    return isGeminiHost(parsed.hostname) && CONVERSATION_PATH.test(parsed.pathname);
  },

  extract(input: ExtractInput): ExtractResult {
    return extractConversation(geminiAdapter, input);
  },
};
