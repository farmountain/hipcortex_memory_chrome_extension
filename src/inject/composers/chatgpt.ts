/**
 * The ChatGPT composer adapter.
 *
 * Every ladder entry here is a *hypothesis about a page nobody in this repository controls*, and the
 * stakes are higher than for a capture ladder: a wrong capture is a refusal, a wrong write puts the
 * user's context into a box they did not choose. `verifiedAt` is the only claim of freshness, and
 * the failure mode is what the specs guarantee — when no rung matches, resolution refuses.
 *
 * Rungs are ordered most specific to least. The composer moved from a `<textarea id="prompt-textarea">`
 * to a ProseMirror editable under the same id, so the id is the first rung and the element kind is
 * the discriminator behind it.
 */

import { matchesHosts } from "../match.js";
import { resolveComposer } from "../resolve.js";
import type { ComposerAdapter } from "../types.js";

/** Hosts that serve the ChatGPT app. */
export const CHATGPT_HOSTS = ["chatgpt.com", "chat.openai.com"] as const;

export const chatgptComposer: ComposerAdapter = {
  id: "chatgpt",
  displayName: "ChatGPT",
  adapterVersion: "1.0.0",
  verifiedAt: "2025-01-15",

  /**
   * The app shell and the form that holds the composer. A signed-out redirect, a rate-limit notice
   * and a loading shell all render something; the landmark check is what separates "the app" from
   * "a page with a `<form>` in it" before any selector is tried.
   */
  landmarks: ["main", "form"],

  ladders: {
    composerRoot: ["main form", "form"],
    composerInput: [
      "#prompt-textarea",
      'form div[contenteditable="true"]',
      "form textarea",
    ],
  },

  matches(url: string): boolean {
    return matchesHosts(url, CHATGPT_HOSTS);
  },

  resolve(document: Document) {
    return resolveComposer(chatgptComposer, document);
  },
};
