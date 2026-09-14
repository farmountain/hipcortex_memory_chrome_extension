import { describe, expect, it } from "vitest";

import {
  VALIDATION_ERROR_CODES,
  describeValidationFailure,
  isUtcTimestamp,
  validateCaptureEvent,
} from "../../src/schema/validate.js";
import type { ValidationError } from "../../src/schema/validate.js";
import { SCHEMA_VERSION } from "../../src/schema/version.js";
import { makeConversation, makeEvent, makeSixMessageConversation } from "../helpers/capture.js";

/**
 * Deep-clone a valid event, then break exactly one thing.
 *
 * Cloning through JSON keeps each case independent; `Reflect.deleteProperty` is used instead of
 * `delete` so removing a key is not a type error once the shape is loosened.
 */
function broken(mutate: (event: Record<string, unknown>) => void): unknown {
  const event = JSON.parse(JSON.stringify(makeEvent())) as Record<string, unknown>;
  mutate(event);
  return event;
}

function provenanceOf(event: Record<string, unknown>): Record<string, unknown> {
  return event["provenance"] as Record<string, unknown>;
}

function conversationOf(event: Record<string, unknown>): Record<string, unknown> {
  return event["conversation"] as Record<string, unknown>;
}

function messagesOf(event: Record<string, unknown>): Array<Record<string, unknown>> {
  return conversationOf(event)["messages"] as Array<Record<string, unknown>>;
}

describe("validateCaptureEvent — accepts what the contract allows", () => {
  const validCases: Array<{ name: string; value: unknown }> = [
    { name: "a complete three-message event", value: makeEvent() },
    { name: "a six-message, two-role event", value: makeEvent({ conversation: makeSixMessageConversation() }) },
    {
      name: "a message with no text but an attachment (image-only prompt)",
      value: makeEvent({
        conversation: makeConversation({
          messages: [
            { index: 0, role: "user", text: "", attachments: [{ kind: "image", url: "https://x/1.png" }] },
            { index: 1, role: "assistant", text: "described" },
          ],
        }),
      }),
    },
    {
      name: "a system-role message and a trailing-fraction timestamp",
      value: makeEvent({
        provenance: {
          schemaVersion: SCHEMA_VERSION,
          provider: "claude",
          adapterVersion: "1.0.0",
          source: "cortexbridge",
          conversationUrl: "https://claude.ai/chat/abc",
          capturedAt: "2025-06-01T12:34:56.7Z",
        },
        conversation: makeConversation({
          messages: [
            { index: 0, role: "system", text: "instructions" },
            { index: 1, role: "tool", text: "result" },
          ],
        }),
      }),
    },
  ];

  it.each(validCases)("$name", ({ value }) => {
    const result = validateCaptureEvent(value);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("validateCaptureEvent — rejects exactly one thing at a time", () => {
  const invalidCases: Array<{ name: string; value: unknown; expected: ValidationError[] }> = [
    {
      name: "the root is null",
      value: null,
      expected: [{ path: "$", code: "REQUIRED" }],
    },
    {
      name: "the root is a string",
      value: "not an event",
      expected: [{ path: "$", code: "REQUIRED" }],
    },
    {
      name: "the root is an array",
      value: [],
      expected: [{ path: "$", code: "REQUIRED" }],
    },
    {
      name: "an empty object: every top-level section is missing",
      value: {},
      expected: [
        { path: "eventId", code: "REQUIRED" },
        { path: "provenance", code: "REQUIRED" },
        { path: "conversation", code: "REQUIRED" },
      ],
    },
    {
      name: "a blank eventId",
      value: broken((event) => {
        event["eventId"] = "   ";
      }),
      expected: [{ path: "eventId", code: "REQUIRED" }],
    },
    {
      name: "provenance present but missing schemaVersion",
      value: broken((event) => {
        Reflect.deleteProperty(provenanceOf(event), "schemaVersion");
      }),
      expected: [{ path: "provenance.schemaVersion", code: "REQUIRED" }],
    },
    {
      name: "an unsupported schemaVersion",
      value: broken((event) => {
        provenanceOf(event)["schemaVersion"] = 99;
      }),
      expected: [{ path: "provenance.schemaVersion", code: "UNSUPPORTED_VERSION" }],
    },
    {
      name: "a missing capturedAt",
      value: broken((event) => {
        Reflect.deleteProperty(provenanceOf(event), "capturedAt");
      }),
      expected: [{ path: "provenance.capturedAt", code: "REQUIRED" }],
    },
    {
      name: "a capturedAt with no timezone (local time)",
      value: broken((event) => {
        provenanceOf(event)["capturedAt"] = "2025-01-01T00:00:00";
      }),
      expected: [{ path: "provenance.capturedAt", code: "INVALID_TIMESTAMP" }],
    },
    {
      name: "a capturedAt with a numeric offset instead of Z",
      value: broken((event) => {
        provenanceOf(event)["capturedAt"] = "2025-01-01T00:00:00+02:00";
      }),
      expected: [{ path: "provenance.capturedAt", code: "INVALID_TIMESTAMP" }],
    },
    {
      name: "an unparseable capturedAt",
      value: broken((event) => {
        provenanceOf(event)["capturedAt"] = "not a date";
      }),
      expected: [{ path: "provenance.capturedAt", code: "INVALID_TIMESTAMP" }],
    },
    {
      name: "a missing provider",
      value: broken((event) => {
        provenanceOf(event)["provider"] = "";
      }),
      expected: [{ path: "provenance.provider", code: "REQUIRED" }],
    },
    {
      name: "a missing conversationUrl",
      value: broken((event) => {
        Reflect.deleteProperty(provenanceOf(event), "conversationUrl");
      }),
      expected: [{ path: "provenance.conversationUrl", code: "REQUIRED" }],
    },
    {
      name: "a conversation with zero messages",
      value: broken((event) => {
        conversationOf(event)["messages"] = [];
      }),
      expected: [{ path: "conversation.messages", code: "EMPTY_CONVERSATION" }],
    },
    {
      name: "a conversation whose messages are not an array",
      value: broken((event) => {
        conversationOf(event)["messages"] = "one";
      }),
      expected: [{ path: "conversation.messages", code: "REQUIRED" }],
    },
    {
      name: "a non-contiguous message index",
      value: broken((event) => {
        messagesOf(event)[1]["index"] = 7;
      }),
      expected: [{ path: "conversation.messages[1].index", code: "REQUIRED" }],
    },
    {
      name: "a role outside the union",
      value: broken((event) => {
        messagesOf(event)[0]["role"] = "narrator";
      }),
      expected: [{ path: "conversation.messages[0].role", code: "REQUIRED" }],
    },
    {
      name: "whitespace-only text with no attachments",
      value: broken((event) => {
        messagesOf(event)[0]["text"] = "   ";
      }),
      expected: [{ path: "conversation.messages[0].text", code: "REQUIRED" }],
    },
    {
      name: "a message that is not an object",
      value: broken((event) => {
        conversationOf(event)["messages"] = ["nope"];
      }),
      expected: [{ path: "conversation.messages[0]", code: "REQUIRED" }],
    },
  ];

  it.each(invalidCases)("$name", ({ value, expected }) => {
    const result = validateCaptureEvent(value);
    expect(result.errors).toEqual(expected);
    expect(result.valid).toBe(false);
  });

  it("emits codes drawn only from the declared vocabulary", () => {
    for (const { value, expected } of invalidCases) {
      validateCaptureEvent(value);
      for (const error of expected) {
        expect(VALIDATION_ERROR_CODES).toContain(error.code);
      }
    }
  });
});

describe("validateCaptureEvent — never throws", () => {
  const hostile: Array<{ name: string; value: unknown }> = [
    { name: "null", value: null },
    { name: "undefined", value: undefined },
    { name: "a number", value: 42 },
    { name: "a string", value: "event" },
    { name: "a bare array", value: [1, 2, 3] },
    { name: "an empty object", value: {} },
    { name: "a Date", value: new Date() },
    { name: "provenance as a string", value: { eventId: "e", provenance: "x", conversation: {} } },
    { name: "conversation as a number", value: { eventId: "e", provenance: {}, conversation: 3 } },
    { name: "a cyclic object", value: (() => { const c: Record<string, unknown> = {}; c["self"] = c; return c; })() },
  ];

  it.each(hostile)("returns a typed failure for $name", ({ value }) => {
    const result = validateCaptureEvent(value);
    expect(typeof result.valid).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("validateCaptureEvent — timestamp rule", () => {
  it.each([
    "2025-01-01T00:00:00Z",
    "2025-01-01T00:00:00.0Z",
    "2025-01-01T00:00:00.123Z",
    "2026-12-31T23:59:59.999Z",
  ])("accepts %s", (value) => {
    expect(isUtcTimestamp(value)).toBe(true);
  });

  it.each([
    "2025-01-01T00:00:00",
    "2025-01-01T00:00:00+02:00",
    "2025-01-01",
    "not a date",
    "",
    "2025-01-01T00:00:00z",
  ])("rejects %s", (value) => {
    expect(isUtcTimestamp(value)).toBe(false);
  });
});

describe("validateCaptureEvent — JSON round trip", () => {
  const original = makeEvent({ conversation: makeSixMessageConversation() });
  const roundTripped = JSON.parse(JSON.stringify(original)) as unknown;

  it("accepts the round-tripped event", () => {
    expect(validateCaptureEvent(roundTripped)).toEqual({ valid: true, errors: [] });
  });

  it("preserves every message's role, index and order", () => {
    const parsed = roundTripped as typeof original;
    expect(parsed.conversation.messages.map((message) => message.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(parsed.conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(parsed.conversation.messages.map((message) => message.text)).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
    ]);
  });

  it("preserves provenance verbatim", () => {
    expect((roundTripped as typeof original).provenance).toEqual(original.provenance);
  });
});

describe("validateCaptureEvent — the diagnostic carries no content", () => {
  const MARKER_TEXT = "MARKER-TRANSCRIPT-TEXT-DO-NOT-LOG";
  const MARKER_URL = "https://chatgpt.com/c/MARKER-URL-DO-NOT-LOG";

  const rejected = broken((event) => {
    Reflect.deleteProperty(event, "eventId");
    const messages = messagesOf(event);
    messages[0]["text"] = MARKER_TEXT;
    provenanceOf(event)["conversationUrl"] = MARKER_URL;
  });

  it("reports the failure", () => {
    expect(validateCaptureEvent(rejected).valid).toBe(false);
  });

  it("contains no message text, no target text and no event body", () => {
    const result = validateCaptureEvent(rejected);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(MARKER_TEXT);
    expect(serialized).not.toContain("MARKER-TRANSCRIPT");
    expect(serialized).not.toContain("MARKER-URL");
    expect(describeValidationFailure(result.errors)).toBe("eventId: REQUIRED");
  });

  it("rejects a message-text-like key anywhere in `EgressRecord`-shaped output", () => {
    // The result type has nowhere to put text: asserting the key set is the strongest available
    // guarantee, because a future field could otherwise reintroduce a leak.
    const result = validateCaptureEvent(rejected);
    for (const error of result.errors) {
      expect(Object.keys(error).sort()).toEqual(["code", "path"]);
    }
  });
});
