/**
 * DeepSeek adapter specs (task 7.4).
 *
 * The contract — identity, URL matching, extraction, ladder rungs, typed failures, purity — is
 * written once in `tests/helpers/adapter-contract.ts` and run here against DeepSeek. This file is
 * only the description of *this* adapter, so the four provider specs cannot drift apart.
 */

import { describeAdapterContract } from "../../helpers/adapter-contract.js";
import { DEEPSEEK_HOSTS, deepseekAdapter } from "../../../src/capture/providers/deepseek.js";

describeAdapterContract({
  adapter: deepseekAdapter,
  hosts: DEEPSEEK_HOSTS,
  conversationUrl: "https://chat.deepseek.com/a/chat/s/redacted-conversation",
  conversationPath: "/a/chat/s/redacted-conversation",
  canonicalRungs: { conversationRoot: 0, turnContainer: 0, messageText: 1, roleSignal: 0 },
  nonMatchingUrls: [
    "https://example.com/a/chat/s/redacted-conversation",
    "https://notchat.deepseek.com/a/chat/s/redacted-conversation",
    "https://chat.deepseek.com.evil.example/a/chat/s/redacted-conversation",
  ],
});
