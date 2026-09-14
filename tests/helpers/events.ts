/**
 * Capture-event builders for specs (task 6.2 and the Group 6 pipeline).
 *
 * The queue, the failure log and the drift counter need *valid* events, not DOM. Building them here
 * keeps those specs about the queue's rules instead of about markup, and every helper result is
 * checked against the real `validateCaptureEvent` — an event constructor that can produce an event
 * the contract rejects would make every queue assertion vacuous in a way no reader would notice.
 */

import { expect } from "vitest";

import { SCHEMA_VERSION, validateCaptureEvent } from "../../src/schema/index.js";
import type { CaptureEvent, Message, MessageRole } from "../../src/schema/index.js";

export interface CaptureEventOptions {
  readonly eventId?: string;
  readonly provider?: string;
  readonly adapterVersion?: string;
  readonly text?: string;
  readonly url?: string;
  readonly capturedAt?: string;
  /** How many messages the conversation holds. Roles alternate user/assistant. */
  readonly messages?: number;
}

export function makeCaptureEvent(options: CaptureEventOptions = {}): CaptureEvent {
  const provider = options.provider ?? "chatgpt";
  const url = options.url ?? "https://chatgpt.com/c/redacted";
  const capturedAt = options.capturedAt ?? "2025-01-15T00:00:00.000Z";
  const count = options.messages ?? 2;

  const messages: Message[] = [];
  for (let index = 0; index < count; index += 1) {
    const role: MessageRole = index % 2 === 0 ? "user" : "assistant";
    messages.push({
      index,
      role,
      text: options.text ?? `message ${index}`,
    });
  }

  return {
    eventId:
      options.eventId ??
      `evt-${provider}-${count}-${options.text ?? "default"}`.replace(/\s+/g, "-"),
    provenance: {
      schemaVersion: SCHEMA_VERSION,
      provider,
      adapterVersion: options.adapterVersion ?? "1.0.0",
      source: "cortexbridge",
      conversationUrl: url,
      capturedAt,
    },
    conversation: { url, messages },
  };
}

/** Assert an event is acceptable to the contract — used to keep this builder honest. */
export function expectValidEvent(event: CaptureEvent): void {
  const validation = validateCaptureEvent(event);
  expect(validation.errors).toEqual([]);
}

/** The text of every message, for "this string must not appear anywhere" assertions. */
export function textsOf(event: CaptureEvent): readonly string[] {
  return event.conversation.messages.map((message) => message.text);
}
