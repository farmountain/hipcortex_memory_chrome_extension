/**
 * Claude adapter specs (task 7.1).
 *
 * The contract — identity, URL matching, extraction, ladder rungs, typed failures, purity — is
 * written once in `tests/helpers/adapter-contract.ts` and run here against Claude. This file is only
 * the description of *this* adapter, so the four provider specs cannot drift apart.
 */

import { describeAdapterContract } from "../../helpers/adapter-contract.js";
import { CLAUDE_HOSTS, claudeAdapter } from "../../../src/capture/providers/claude.js";

describeAdapterContract({
  adapter: claudeAdapter,
  hosts: CLAUDE_HOSTS,
  conversationUrl: "https://claude.ai/chat/redacted-conversation",
  conversationPath: "/chat/redacted-conversation",
  canonicalRungs: { conversationRoot: 0, turnContainer: 0, messageText: 1, roleSignal: 0 },
  nonMatchingUrls: [
    "https://example.com/chat/redacted-conversation",
    "https://notclaude.ai/chat/redacted-conversation",
    "https://claude.ai.evil.example/chat/redacted-conversation",
  ],
});
