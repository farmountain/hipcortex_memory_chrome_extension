/**
 * The DeepSeek composer adapter.
 *
 * DeepSeek's composer is a `<textarea id="chat-input">` inside the app shell. The id is the first
 * rung and the plain control is the second, which is the same ordering the ChatGPT adapter uses:
 * identify by the id the app gives, fall back to the element kind.
 */

import { matchesHosts } from "../match.js";
import { resolveComposer } from "../resolve.js";
import type { ComposerAdapter } from "../types.js";

export const DEEPSEEK_HOSTS = ["chat.deepseek.com"] as const;

export const deepseekComposer: ComposerAdapter = {
  id: "deepseek",
  displayName: "DeepSeek",
  adapterVersion: "1.0.0",
  verifiedAt: "2025-01-15",

  landmarks: ["main"],

  ladders: {
    composerRoot: ["main", "body"],
    composerInput: ["#chat-input", "main textarea"],
  },

  matches(url: string): boolean {
    return matchesHosts(url, DEEPSEEK_HOSTS);
  },

  resolve(document: Document) {
    return resolveComposer(deepseekComposer, document);
  },
};
