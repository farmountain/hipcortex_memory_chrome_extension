/**
 * Normalization specs (task 6.1).
 *
 * Two claims are worth more than the rest and are tested first: the event's provenance is the
 * adapter's own (so `provider` cannot drift from the adapter that produced the capture), and a
 * rejection's diagnostic is made of paths and codes only — asserted against the real message texts,
 * because "no leak" is meaningless without something that could have leaked.
 */

import { describe, expect, it } from "vitest";

import { parseFixture, readFixture } from "../helpers/fixtures.js";
import { expectExtractSuccess } from "../helpers/extract.js";
import { chatgptAdapter } from "../../src/capture/providers/chatgpt.js";
import { extractConversation } from "../../src/capture/extract.js";
import { newEventId, normalizeCapture } from "../../src/capture/normalize/normalize.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import type { CaptureEvent, Conversation, Provenance } from "../../src/schema/index.js";
import type { ExtractSuccess } from "../../src/capture/providers/types.js";

const URL = "https://chatgpt.com/c/redacted";
const CAPTURED_AT = "2025-01-15T00:00:00.000Z";

function successfulExtraction(): ExtractSuccess {
  return expectExtractSuccess(
    extractConversation(chatgptAdapter, {
      document: parseFixture(readFixture("chatgpt", "conversation.html")),
      url: URL,
      title: "Redacted conversation",
      capturedAt: CAPTURED_AT,
    })
  );
}

/** A copy of a real success with one field replaced, typed as the adapter produced it. */
function withProvenance(success: ExtractSuccess, patch: Partial<Provenance>): ExtractSuccess {
  return { ...success, provenance: { ...success.provenance, ...patch } };
}

function withConversation(success: ExtractSuccess, conversation: Conversation): ExtractSuccess {
  return { ...success, conversation };
}

describe("event identity", () => {
  it("produces a new, non-empty id per call", () => {
    const ids = new Set<string>();
    for (let index = 0; index < 200; index += 1) ids.add(newEventId());

    expect(ids.size).toBe(200);
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0);
  });
});

describe("normalizeCapture — success", () => {
  it("builds an event with exactly the three contract members", () => {
    const result = normalizeCapture(successfulExtraction(), "evt-1");
    if (!result.ok) throw new Error(`expected success, got ${result.code}`);

    expect(Object.keys(result.event).sort()).toEqual(["conversation", "eventId", "provenance"]);
    expect(result.event.eventId).toBe("evt-1");
  });

  it("carries the adapter's own provenance and conversation verbatim", () => {
    const success = successfulExtraction();
    const result = normalizeCapture(success, "evt-2");
    if (!result.ok) throw new Error(`expected success, got ${result.code}`);

    // Identity, not equality: normalization must not re-derive provenance, or `provider` could
    // disagree with the adapter that produced the capture (G1.5).
    expect(result.event.provenance).toBe(success.provenance);
    expect(result.event.conversation).toBe(success.conversation);
    expect(result.event.provenance.provider).toBe(chatgptAdapter.id);
    expect(result.event.provenance.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("does not copy the diagnostic rungs into the event", () => {
    const result = normalizeCapture(successfulExtraction(), "evt-3");
    if (!result.ok) throw new Error(`expected success, got ${result.code}`);

    expect("rungs" in result.event).toBe(false);
  });

  it("leaves the extraction result untouched", () => {
    const success = successfulExtraction();
    const before = JSON.stringify(success);
    normalizeCapture(success, "evt-4");

    expect(JSON.stringify(success)).toBe(before);
  });
});

describe("normalizeCapture — refusal", () => {
  it("refuses an empty event id", () => {
    const empty = normalizeCapture(successfulExtraction(), "");
    const blank = normalizeCapture(successfulExtraction(), "   ");

    expect(empty).toEqual({ ok: false, code: "INVALID_EVENT_ID", detail: "eventId is empty" });
    expect(blank).toEqual({ ok: false, code: "INVALID_EVENT_ID", detail: "eventId is empty" });
  });

  it("refuses a conversation with no messages", () => {
    const success = successfulExtraction();
    const result = normalizeCapture(
      withConversation(success, { ...success.conversation, messages: [] }),
      "evt-5"
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("EMPTY_CONVERSATION");
    expect(result.detail).toContain("conversation.messages: EMPTY_CONVERSATION");
  });

  it("refuses a non-UTC timestamp and reports the code without the transcript", () => {
    const success = successfulExtraction();
    const texts = success.conversation.messages.map((message) => message.text);
    const result = normalizeCapture(withProvenance(success, { capturedAt: "2025-01-15 00:00:00" }), "evt-6");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("INVALID_TIMESTAMP");
    expect(result.detail).toBe("provenance.capturedAt: INVALID_TIMESTAMP");

    // The fixture's messages are non-empty, so this is a real absence rather than a vacuous one.
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
      expect(result.detail).not.toContain(text);
    }
  });

  it("reports only paths and codes when several members are wrong", () => {
    const success = successfulExtraction();
    const broken: CaptureEvent = {
      eventId: "evt-7",
      provenance: { ...success.provenance, provider: "", capturedAt: "nope" },
      conversation: { url: "", messages: [] },
    };

    // The cast is the point: the validator runs on the object, not on the parameter's type, so a
    // caller that lies about its input still gets a typed refusal instead of an unvalidated event.
    const result = normalizeCapture(broken as unknown as ExtractSuccess, "evt-7");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.detail).toBe(
      "provenance.provider: REQUIRED; provenance.capturedAt: INVALID_TIMESTAMP; " +
        "conversation.url: REQUIRED; conversation.messages: EMPTY_CONVERSATION"
    );
  });
});
