/**
 * ChatGPT adapter specs (tasks 5.7, 5.8, 5.10, 5.11 of groups/capture).
 *
 * Every case runs against a redacted fixture rather than a live page, so the specs do not depend on
 * the provider's current build — which is exactly the property `verifiedAt` exists to record.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseFixture, readFixture } from "../../helpers/fixtures.js";
import { expectExtractFailure, expectExtractSuccess } from "../../helpers/extract.js";
import { chatgptAdapter, CHATGPT_HOSTS } from "../../../src/capture/providers/chatgpt.js";
import { EXTRACT_ERROR_CODES } from "../../../src/capture/providers/types.js";
import type { CaptureSlot, ExtractResult } from "../../../src/capture/providers/types.js";
import { CAPTURE_SOURCE, isUtcTimestamp, SCHEMA_VERSION } from "../../../src/schema/index.js";

const CONVERSATION_URL = "https://chatgpt.com/c/redacted-conversation";

function extractFixture(name: string, url = CONVERSATION_URL, capturedAt?: string): ExtractResult {
  const document = parseFixture(readFixture("chatgpt", name));
  return chatgptAdapter.extract({ document, url, capturedAt });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ChatGPT adapter identity", () => {
  it("declares the provenance fields the contract requires", () => {
    expect(chatgptAdapter.id).toBe("chatgpt");
    expect(chatgptAdapter.displayName.length).toBeGreaterThan(0);
    expect(chatgptAdapter.adapterVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(chatgptAdapter.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isUtcTimestamp(`${chatgptAdapter.verifiedAt}T00:00:00.000Z`)).toBe(true);
  });

  it("verifies no date in the future — G8.1", () => {
    // A future date would let an unverified selector ladder claim to be verified.
    expect(new Date(`${chatgptAdapter.verifiedAt}T00:00:00.000Z`).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("declares at least one landmark and an ordered ladder for every slot", () => {
    expect(chatgptAdapter.landmarks.length).toBeGreaterThan(0);
    for (const slot of Object.keys(chatgptAdapter.ladders) as CaptureSlot[]) {
      expect(chatgptAdapter.ladders[slot].length).toBeGreaterThan(1);
    }
  });
});

describe("ChatGPT URL matching — G1.2", () => {
  it("matches each declared host on a conversation path", () => {
    for (const host of CHATGPT_HOSTS) {
      expect(chatgptAdapter.matches(`https://${host}/c/redacted-conversation`), host).toBe(true);
    }
  });

  it("matches a subdomain of a declared host", () => {
    expect(chatgptAdapter.matches("https://chat.openai.com/c/redacted-conversation")).toBe(true);
    expect(chatgptAdapter.matches("https://www.chatgpt.com/c/redacted-conversation")).toBe(true);
  });

  it("does not match an unrelated host", () => {
    expect(chatgptAdapter.matches("https://example.com/chat")).toBe(false);
  });

  it("does not match a declared host without a conversation path", () => {
    // The root and settings pages of the provider are not conversations, and capturing them would
    // produce an empty conversation from a page that merely shares the hostname.
    expect(chatgptAdapter.matches("https://chatgpt.com/")).toBe(false);
    expect(chatgptAdapter.matches("https://chatgpt.com/settings")).toBe(false);
  });

  it("does not match a lookalike host or a non-http scheme", () => {
    expect(chatgptAdapter.matches("https://notchatgpt.com/c/redacted-conversation")).toBe(false);
    expect(chatgptAdapter.matches("https://chatgpt.com.evil.example/c/redacted-conversation")).toBe(false);
    expect(chatgptAdapter.matches("ftp://chatgpt.com/c/redacted-conversation")).toBe(false);
  });

  it("does not throw on an unparseable URL", () => {
    expect(chatgptAdapter.matches("not a url")).toBe(false);
  });
});

describe("ChatGPT extraction — G1.3, G1.5", () => {
  it("extracts every turn in order with its role preserved", () => {
    const success = expectExtractSuccess(extractFixture("conversation.html"));

    expect(success.conversation.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(success.conversation.messages.map((message) => message.text)).toEqual([
      "REDACTED-USER-1",
      "REDACTED-ASSISTANT-1",
      "REDACTED-USER-2",
      "REDACTED-ASSISTANT-2",
    ]);
    expect(success.conversation.title).toBe("Redacted conversation");
    expect(success.conversation.messages.map((message) => message.index)).toEqual([0, 1, 2, 3]);
  });

  it("builds provenance that names the adapter that produced it — G1.5", () => {
    const success = expectExtractSuccess(extractFixture("conversation.html"));

    expect(success.provenance.provider).toBe(chatgptAdapter.id);
    expect(success.provenance.adapterVersion).toBe(chatgptAdapter.adapterVersion);
    expect(success.provenance.source).toBe(CAPTURE_SOURCE);
    expect(success.provenance.schemaVersion).toBe(SCHEMA_VERSION);
    expect(success.provenance.conversationUrl).toBe(CONVERSATION_URL);
    expect(isUtcTimestamp(success.provenance.capturedAt)).toBe(true);
    expect(Object.keys(success.provenance).sort()).toEqual([
      "adapterVersion",
      "capturedAt",
      "conversationUrl",
      "provider",
      "schemaVersion",
      "source",
    ]);
  });

  it("honours an injected capture time", () => {
    const capturedAt = "2025-01-15T12:00:00.000Z";
    const success = expectExtractSuccess(extractFixture("conversation.html", CONVERSATION_URL, capturedAt));
    expect(success.provenance.capturedAt).toBe(capturedAt);
  });

  it("canonicalises the conversation URL by dropping query and fragment", () => {
    const success = expectExtractSuccess(
      extractFixture("conversation.html", "https://chatgpt.com/c/redacted-conversation?model=gpt-4#latest")
    );

    expect(success.conversation.url).toBe(CONVERSATION_URL);
    expect(success.provenance.conversationUrl).toBe(CONVERSATION_URL);
  });

  it("reads an image-only turn as a message with an attachment", () => {
    const document = parseFixture(readFixture("chatgpt", "attachments.html"));
    const success = expectExtractSuccess(chatgptAdapter.extract({ document, url: CONVERSATION_URL }));

    expect(success.conversation.messages).toHaveLength(3);
    expect(success.conversation.messages[1].text).toBe("");
    expect(success.conversation.messages[1].attachments).toEqual([
      { kind: "image", url: "https://chatgpt.com/backend-api/estuary/content?id=redacted" },
    ]);
  });
});

describe("ChatGPT ladder rungs — G8.2, G8.5", () => {
  const CASES: ReadonlyArray<{ fixture: string; expected: Readonly<Record<CaptureSlot, number>> }> = [
    {
      fixture: "conversation.html",
      expected: { conversationRoot: 0, turnContainer: 0, messageText: 2, roleSignal: 0 },
    },
    {
      fixture: "rung-conversationRoot-1.html",
      expected: { conversationRoot: 1, turnContainer: 0, messageText: 2, roleSignal: 0 },
    },
    {
      fixture: "rung-turnContainer-1.html",
      expected: { conversationRoot: 0, turnContainer: 1, messageText: 2, roleSignal: 0 },
    },
    {
      fixture: "rung-messageText-0.html",
      expected: { conversationRoot: 0, turnContainer: 0, messageText: 0, roleSignal: 0 },
    },
    {
      fixture: "rung-messageText-1.html",
      expected: { conversationRoot: 0, turnContainer: 0, messageText: 1, roleSignal: 0 },
    },
    {
      fixture: "rung-messageText-2.html",
      expected: { conversationRoot: 0, turnContainer: 0, messageText: 2, roleSignal: 0 },
    },
    {
      fixture: "rung-roleSignal-1.html",
      expected: { conversationRoot: 0, turnContainer: 0, messageText: 2, roleSignal: 1 },
    },
  ];

  for (const { fixture, expected } of CASES) {
    it(`reports the rung that satisfied each slot for ${fixture} — G8.2`, () => {
      const success = expectExtractSuccess(extractFixture(fixture));

      expect(success.rungs).toEqual(expected);
      expect(success.conversation.messages.length).toBeGreaterThanOrEqual(3);
      expect(new Set(success.conversation.messages.map((message) => message.role)).size).toBeGreaterThanOrEqual(2);
    });
  }

  it("has at least one fixture selecting every declared rung of every slot — G8.5", () => {
    // Derived from the same table the cases above assert on, so adding a rung to an adapter ladder
    // fails here until a fixture is added that reaches it.
    for (const slot of ["conversationRoot", "turnContainer", "messageText", "roleSignal"] as CaptureSlot[]) {
      const covered = new Set(CASES.map((testCase) => testCase.expected[slot]));
      const declared = chatgptAdapter.ladders[slot].map((_selector, index) => index);
      expect([...covered].sort((a, b) => a - b), slot).toEqual(declared);
    }
  });
});

describe("ChatGPT typed failures — G1.4, G7.6, G8.3, G8.7", () => {
  it("returns DOM_SHAPE_UNRECOGNIZED when a landmark is missing — G8.3", () => {
    const failure = expectExtractFailure(extractFixture("unknown-shape.html"));

    expect(failure.code).toBe("DOM_SHAPE_UNRECOGNIZED");
    expect(EXTRACT_ERROR_CODES).toContain(failure.code);
    expect(failure.detail).toContain("form");
  });

  it("reads no message text before deciding the shape is unrecognised — G8.3", () => {
    const document = parseFixture(readFixture("chatgpt", "unknown-shape.html"));
    // The fixture contains readable text behind a valid turn container, so a capture that skipped
    // the landmark gate would succeed here rather than fail — this asserts the gate runs first.
    expect(document.documentElement.textContent).toContain("MARKER-MUST-NOT-BE-READ");

    const reads = vi.spyOn(Node.prototype, "textContent", "get");
    const failure = expectExtractFailure(chatgptAdapter.extract({ document, url: CONVERSATION_URL }));

    expect(failure.code).toBe("DOM_SHAPE_UNRECOGNIZED");
    expect(reads).not.toHaveBeenCalled();
  });

  it("does read message text on the canonical fixture, so the probe above is not vacuous", () => {
    const document = parseFixture(readFixture("chatgpt", "conversation.html"));
    const reads = vi.spyOn(Node.prototype, "textContent", "get");

    expectExtractSuccess(chatgptAdapter.extract({ document, url: CONVERSATION_URL }));
    expect(reads.mock.calls.length).toBeGreaterThan(0);
  });

  it("returns EMPTY_CONVERSATION for a recognised shell holding no turns — G7.6", () => {
    const failure = expectExtractFailure(extractFixture("no-turns.html"));

    expect(failure.code).toBe("EMPTY_CONVERSATION");
    expect(failure.slot).toBe("turnContainer");
    expect(failure).not.toHaveProperty("conversation");
  });

  it("returns NO_ROLE_SIGNAL rather than assuming roles alternate — G1.4", () => {
    const failure = expectExtractFailure(extractFixture("no-role.html"));

    expect(failure.code).toBe("NO_ROLE_SIGNAL");
    expect(failure).not.toHaveProperty("conversation");
  });

  it("returns UNSUPPORTED_LAYOUT for a role token it cannot map — G1.4", () => {
    const document = parseFixture(readFixture("chatgpt", "unsupported-role.html"));
    const failure = expectExtractFailure(chatgptAdapter.extract({ document, url: CONVERSATION_URL }));

    expect(failure.code).toBe("UNSUPPORTED_LAYOUT");
    expect(failure.slot).toBe("roleSignal");
  });

  it("never returns a partially-populated conversation — G8.7", () => {
    const failure = expectExtractFailure(extractFixture("partial.html"));

    // Four turn containers, three readable texts: reporting three messages would look like a
    // successful capture and the missing turn would be undetectable downstream.
    expect(failure.code).toBe("MESSAGE_COUNT_MISMATCH");
    expect(failure.detail).toContain("4");
    expect(failure).not.toHaveProperty("conversation");
  });

  it("emits only codes the error union declares", () => {
    for (const fixture of ["unknown-shape.html", "no-turns.html", "no-role.html", "partial.html"]) {
      const failure = expectExtractFailure(extractFixture(fixture));
      expect(EXTRACT_ERROR_CODES, fixture).toContain(failure.code);
    }
  });
});

describe("ChatGPT extraction purity — G1.6", () => {
  it("mutates nothing in the page it reads", () => {
    const document = parseFixture(readFixture("chatgpt", "conversation.html"));
    const before = document.documentElement.outerHTML;

    expectExtractSuccess(chatgptAdapter.extract({ document, url: CONVERSATION_URL }));

    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("mutates nothing when it fails", () => {
    const document = parseFixture(readFixture("chatgpt", "unknown-shape.html"));
    const before = document.documentElement.outerHTML;

    expectExtractFailure(chatgptAdapter.extract({ document, url: CONVERSATION_URL }));

    expect(document.documentElement.outerHTML).toBe(before);
  });
});
