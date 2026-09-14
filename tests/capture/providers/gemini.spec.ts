/**
 * Gemini adapter specs (task 7.2).
 *
 * The contract — identity, URL matching, extraction, ladder rungs, typed failures, purity — is
 * written once in `tests/helpers/adapter-contract.ts` and run here against Gemini. This file is only
 * the description of *this* adapter, so the four provider specs cannot drift apart.
 */

import { describeAdapterContract } from "../../helpers/adapter-contract.js";
import { GEMINI_HOSTS, geminiAdapter } from "../../../src/capture/providers/gemini.js";

describeAdapterContract({
  adapter: geminiAdapter,
  hosts: GEMINI_HOSTS,
  conversationUrl: "https://gemini.google.com/app/redacted-conversation",
  conversationPath: "/app/redacted-conversation",
  canonicalRungs: { conversationRoot: 0, turnContainer: 0, messageText: 1, roleSignal: 0 },
  nonMatchingUrls: [
    "https://example.com/app/redacted-conversation",
    "https://notgemini.google.com/app/redacted-conversation",
    "https://gemini.google.com.evil.example/app/redacted-conversation",
  ],
});
