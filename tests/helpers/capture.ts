/**
 * Capture-event factories for specs.
 *
 * Kept as a helper rather than duplicated per spec file so that "a valid event" has exactly one
 * definition: when the contract gains a required field, every spec that builds an event updates in
 * one place, and the specs that are *supposed* to be invalid keep overriding one field at a time.
 */

import type { CaptureEvent } from "../../src/schema/capture-event.js";
import type { Conversation } from "../../src/schema/conversation.js";
import { SCHEMA_VERSION } from "../../src/schema/version.js";

export const VALID_CAPTURED_AT = "2025-01-01T00:00:00.000Z";

export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    title: "A conversation",
    url: "https://chatgpt.com/c/abc",
    messages: [
      { index: 0, role: "user", text: "hello" },
      { index: 1, role: "assistant", text: "hi" },
      { index: 2, role: "user", text: "bye" },
    ],
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<CaptureEvent> = {}): CaptureEvent {
  return {
    eventId: "3f1c0000-0000-4000-8000-000000000000",
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      provider: "chatgpt",
      adapterVersion: "1.0.0",
      source: "cortexbridge",
      conversationUrl: "https://chatgpt.com/c/abc",
      capturedAt: VALID_CAPTURED_AT,
    },
    conversation: makeConversation(),
    ...overrides,
  };
}

/** A six-message, two-role conversation used for round-trip assertions. */
export function makeSixMessageConversation(): Conversation {
  return {
    title: "Six messages",
    url: "https://chatgpt.com/c/six",
    messages: [
      { index: 0, role: "user", text: "one" },
      { index: 1, role: "assistant", text: "two" },
      { index: 2, role: "user", text: "three" },
      { index: 3, role: "assistant", text: "four" },
      { index: 4, role: "user", text: "five" },
      { index: 5, role: "assistant", text: "six" },
    ],
  };
}
