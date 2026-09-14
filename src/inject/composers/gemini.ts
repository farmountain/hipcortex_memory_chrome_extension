/**
 * The Gemini composer adapter.
 *
 * Gemini wraps its input in the custom element `<rich-textarea>` and renders a Quill editable inside
 * it. The custom element is both a landmark and the root rung, so the two checks agree about what a
 * composer page is; the class-based rung is behind it because a Quill upgrade renames its own
 * classes but not the host element the app renders.
 */

import { matchesHosts } from "../match.js";
import { resolveComposer } from "../resolve.js";
import type { ComposerAdapter } from "../types.js";

export const GEMINI_HOSTS = ["gemini.google.com"] as const;

export const geminiComposer: ComposerAdapter = {
  id: "gemini",
  displayName: "Gemini",
  adapterVersion: "1.0.0",
  verifiedAt: "2025-01-15",

  landmarks: ["main", "rich-textarea"],

  ladders: {
    composerRoot: ["rich-textarea", "main form", "main"],
    composerInput: [
      "rich-textarea .ql-editor",
      'rich-textarea div[contenteditable="true"]',
      "rich-textarea textarea",
    ],
  },

  matches(url: string): boolean {
    return matchesHosts(url, GEMINI_HOSTS);
  },

  resolve(document: Document) {
    return resolveComposer(geminiComposer, document);
  },
};
