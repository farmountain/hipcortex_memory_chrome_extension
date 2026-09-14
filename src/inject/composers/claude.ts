/**
 * The Claude composer adapter.
 *
 * Claude renders its composer inside a `<fieldset>` with a ProseMirror editable, which is why the
 * fieldset is the structural rung and the editable is the node rung. The ladder order is the
 * mitigation for drift: a rename in the element's own attributes leaves the structural rung working,
 * and the report's `rungs` says the page forced the resolver further down.
 */

import { matchesHosts } from "../match.js";
import { resolveComposer } from "../resolve.js";
import type { ComposerAdapter } from "../types.js";

export const CLAUDE_HOSTS = ["claude.ai"] as const;

export const claudeComposer: ComposerAdapter = {
  id: "claude",
  displayName: "Claude",
  adapterVersion: "1.0.0",
  verifiedAt: "2025-01-15",

  landmarks: ["main", "fieldset"],

  ladders: {
    composerRoot: ["main fieldset", "fieldset", "main form"],
    composerInput: [
      'fieldset div[contenteditable="true"]',
      '[data-testid="chat-input"]',
      "fieldset textarea",
    ],
  },

  matches(url: string): boolean {
    return matchesHosts(url, CLAUDE_HOSTS);
  },

  resolve(document: Document) {
    return resolveComposer(claudeComposer, document);
  },
};
