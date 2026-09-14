/**
 * Grok adapter specs (task 7.3).
 *
 * The contract — identity, URL matching, extraction, ladder rungs, typed failures, purity — is
 * written once in `tests/helpers/adapter-contract.ts` and run here against Grok. This file is only
 * the description of *this* adapter, so the four provider specs cannot drift apart.
 */

import { describeAdapterContract } from "../../helpers/adapter-contract.js";
import { GROK_HOSTS, grokAdapter } from "../../../src/capture/providers/grok.js";

describeAdapterContract({
  adapter: grokAdapter,
  hosts: GROK_HOSTS,
  conversationUrl: "https://grok.com/chat/redacted-conversation",
  conversationPath: "/chat/redacted-conversation",
  canonicalRungs: { conversationRoot: 0, turnContainer: 0, messageText: 1, roleSignal: 0 },
  nonMatchingUrls: [
    "https://example.com/chat/redacted-conversation",
    "https://notgrok.com/chat/redacted-conversation",
    "https://grok.com.evil.example/chat/redacted-conversation",
  ],
});
