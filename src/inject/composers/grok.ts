/**
 * The Grok composer adapter.
 *
 * Grok's input has been a `<textarea>` inside the composer form and, in later builds, an editable
 * div in the same place. Both rungs are scoped to the form, so a stray `textarea` elsewhere on the
 * page — a search box, a feedback field — cannot resolve: the containment check would refuse it, but
 * scoping the selector means it never resolves in the first place.
 */

import { matchesHosts } from "../match.js";
import { resolveComposer } from "../resolve.js";
import type { ComposerAdapter } from "../types.js";

export const GROK_HOSTS = ["grok.com"] as const;

export const grokComposer: ComposerAdapter = {
  id: "grok",
  displayName: "Grok",
  adapterVersion: "1.0.0",
  verifiedAt: "2025-01-15",

  landmarks: ["main", "form"],

  ladders: {
    composerRoot: ["main form", "form"],
    composerInput: ["form textarea", 'form div[contenteditable="true"]'],
  },

  matches(url: string): boolean {
    return matchesHosts(url, GROK_HOSTS);
  },

  resolve(document: Document) {
    return resolveComposer(grokComposer, document);
  },
};
