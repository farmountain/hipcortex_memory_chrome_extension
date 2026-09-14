/**
 * Content-script specs (tasks 6.12, 6.13, 6.14).
 *
 * The content script is the only code that runs inside a provider's page, so the specs here are
 * written to pin down what it *does not* do as much as what it does: an unsupported page yields no
 * capture at all, an unchanged DOM costs nothing, a settled mutation carries the whole conversation
 * rather than a delta, and a hand-over that throws leaves the page as the only copy (so the next
 * mutation tries again) instead of marking as delivered something that never left the tab.
 *
 * Mutations are driven against a parsed fixture document rather than the jsdom global one: a
 * `MutationObserver` works on any node, detached or not, so the timing tests stay deterministic and
 * cannot leak a mutated document into another spec.
 */

import { describe, expect, it } from "vitest";

import { parseFixture, readFixture } from "../helpers/fixtures.js";
import { expectExtractSuccess } from "../helpers/extract.js";
import { chatgptAdapter } from "../../src/capture/providers/chatgpt.js";
import { extractConversation } from "../../src/capture/extract.js";
import { signatureOf, startContentCapture } from "../../src/content/entry.js";
import type { ContentOutcome, ContentSession } from "../../src/content/entry.js";
import type { ExtractResult, ExtractSuccess } from "../../src/capture/providers/types.js";
import type { Message } from "../../src/schema/conversation.js";
import type { MessageResponse, MessageType } from "../../src/types/index.js";

const CHATGPT_URL = "https://chatgpt.com/c/redacted";
const CAPTURED_AT = "2025-01-15T00:00:00.000Z";

function fixtureDocument(): Document {
  return parseFixture(readFixture("chatgpt", "conversation.html"));
}

function conversationRoot(doc: Document): HTMLElement {
  const root = doc.querySelector("main#conversation-root");
  if (!(root instanceof HTMLElement)) throw new Error("the fixture has no conversation root");
  return root;
}

/** Append a turn shaped the way the fixture's turns are shaped, and return it. */
function appendTurn(doc: Document, index: number, role: "user" | "assistant", text: string): HTMLElement {
  const turn = doc.createElement("div");
  turn.setAttribute("data-testid", `conversation-turn-${index}`);
  turn.setAttribute("data-message-author-role", role);
  const body = doc.createElement("div");
  body.className = role === "assistant" ? "markdown" : "whitespace-pre-wrap";
  body.textContent = text;
  turn.appendChild(body);
  conversationRoot(doc).appendChild(turn);
  return turn;
}

interface Harness {
  readonly session: ContentSession;
  readonly messages: MessageType[];
  readonly results: ExtractResult[];
}

interface HarnessOptions {
  readonly url?: string;
  readonly doc?: Document;
  readonly observe?: boolean;
  readonly debounceMs?: number;
  readonly send?: (message: MessageType) => Promise<MessageResponse>;
}

function harness(options: HarnessOptions = {}): Harness {
  const doc = options.doc ?? fixtureDocument();
  const messages: MessageType[] = [];
  const results: ExtractResult[] = [];

  const send =
    options.send ??
    (async (message: MessageType): Promise<MessageResponse> => {
      messages.push(message);
      if (message.type === "CAPTURE_UPDATE") results.push(message.result);
      return { success: true };
    });

  const session = startContentCapture({
    url: () => options.url ?? CHATGPT_URL,
    title: () => "Redacted conversation",
    doc: () => doc,
    send,
    debounceMs: options.debounceMs ?? 10,
    now: () => new Date(CAPTURED_AT),
    observe: options.observe ?? false,
  });

  return { session, messages, results };
}

function updateOf(messages: readonly MessageType[], index: number): Extract<MessageType, { type: "CAPTURE_UPDATE" }> {
  const message = messages[index];
  if (!message || message.type !== "CAPTURE_UPDATE") {
    throw new Error(`expected a CAPTURE_UPDATE at index ${index}, got ${message?.type ?? "nothing"}`);
  }
  return message;
}

function messagesOf(result: ExtractResult): readonly Message[] {
  return expectExtractSuccess(result).conversation.messages;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("adapter resolution (G1.7)", () => {
  it("produces nothing at all on a page with no adapter", async () => {
    const { session, messages } = harness({ url: "https://example.com/chat/123" });

    await expect(session.flush()).resolves.toEqual({ status: "unsupported" });
    expect(messages).toEqual([]);
    session.stop();
  });

  it("resolves the adapter from the page URL and names it in the message", async () => {
    const { session, messages } = harness();

    await expect(session.flush()).resolves.toEqual({
      status: "sent",
      providerId: chatgptAdapter.id,
      extractionOk: true,
    });

    const update = updateOf(messages, 0);
    expect(update.providerId).toBe("chatgpt");
    expect(update.url).toBe(CHATGPT_URL);
    session.stop();
  });
});

describe("change detection (6.13)", () => {
  it("sends the whole conversation on the first observation", async () => {
    const { session, messages } = harness();

    await session.flush();

    const result = updateOf(messages, 0).result;
    const messages2 = messagesOf(result);
    expect(messages2).toHaveLength(4);
    expect(messages2.map((message) => message.text)).toEqual([
      "REDACTED-USER-1",
      "REDACTED-ASSISTANT-1",
      "REDACTED-USER-2",
      "REDACTED-ASSISTANT-2",
    ]);
    expect(expectExtractSuccess(result).provenance.capturedAt).toBe(CAPTURED_AT);
    session.stop();
  });

  it("sends nothing when nothing changed", async () => {
    const { session, messages } = harness();

    await session.flush();
    const second: ContentOutcome = await session.flush();

    expect(second).toEqual({ status: "unchanged" });
    expect(messages).toHaveLength(1);
    session.stop();
  });

  it("sends the full conversation again when a message is added, not a delta", async () => {
    const doc = fixtureDocument();
    const { session, messages } = harness({ doc });

    await session.flush();
    appendTurn(doc, 4, "user", "REDACTED-USER-3");
    await expect(session.flush()).resolves.toMatchObject({ status: "sent" });

    expect(messages).toHaveLength(2);
    const texts = messagesOf(updateOf(messages, 1).result).map((message) => message.text);
    expect(texts).toEqual([
      "REDACTED-USER-1",
      "REDACTED-ASSISTANT-1",
      "REDACTED-USER-2",
      "REDACTED-ASSISTANT-2",
      "REDACTED-USER-3",
    ]);
    session.stop();
  });

  it("reports an unrecognised shape once, not on every settlement", async () => {
    const doc = parseFixture(readFixture("chatgpt", "unknown-shape.html"));
    const { session, messages } = harness({ doc });

    const first = await session.flush();
    const second = await session.flush();

    expect(first).toEqual({ status: "sent", providerId: "chatgpt", extractionOk: false });
    expect(second).toEqual({ status: "unchanged" });
    expect(messages).toHaveLength(1);
    expect(updateOf(messages, 0).result.ok).toBe(false);
    session.stop();
  });

  it("ignores a mutation that does not change the conversation", async () => {
    const doc = fixtureDocument();
    const { session, messages } = harness({ doc, observe: true, debounceMs: 5 });
    await session.flush();

    const decorative = doc.createElement("div");
    decorative.className = "scroller-state";
    conversationRoot(doc).insertBefore(decorative, conversationRoot(doc).firstChild);

    await sleep(60);
    expect(messages).toHaveLength(1);
    session.stop();
  });

  it("debounces rapid mutations into one send carrying the settled text", async () => {
    const doc = fixtureDocument();
    const { session, messages } = harness({ doc, observe: true, debounceMs: 10 });
    await session.flush();

    const target = doc.querySelector('[data-testid="conversation-turn-3"] .markdown');
    if (!target) throw new Error("the fixture has no assistant turn to grow");
    for (const token of ["A", "B", "C", "D", "E"]) {
      target.textContent = `REDACTED-ASSISTANT-2${token}`;
      await sleep(1);
    }

    await sleep(80);

    expect(messages).toHaveLength(2);
    const texts = messagesOf(updateOf(messages, 1).result).map((message) => message.text);
    expect(texts[3]).toBe("REDACTED-ASSISTANT-2E");
    session.stop();
  });

  it("coalesces concurrent flushes into one extraction", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { session, messages } = harness({
      send: async (message: MessageType): Promise<MessageResponse> => {
        messages.push(message);
        await gate;
        return { success: true };
      },
    });

    const first = session.flush();
    const second = session.flush();

    expect(second).toBe(first);
    release();
    await expect(first).resolves.toMatchObject({ status: "sent" });
    expect(messages).toHaveLength(1);
    session.stop();
  });
});

describe("hand-over failure keeps the page as the only copy", () => {
  it("reports unsent and retries on the next flush", async () => {
    let failNext = true;
    const attempts: MessageType[] = [];
    const { session, messages } = harness({
      send: async (message: MessageType): Promise<MessageResponse> => {
        attempts.push(message);
        if (failNext) {
          failNext = false;
          throw new Error("receiving end does not exist");
        }
        messages.push(message);
        return { success: true };
      },
    });

    const failed = await session.flush();

    expect(failed).toEqual({
      status: "unsent",
      providerId: "chatgpt",
      detail: "receiving end does not exist",
    });
    expect(await session.flush()).toMatchObject({ status: "sent" });
    expect(attempts).toHaveLength(2);
    expect(messages).toHaveLength(1);
    session.stop();
  });
});

describe("stop", () => {
  it("disconnects observation so later mutations send nothing", async () => {
    const doc = fixtureDocument();
    const { session, messages } = harness({ doc, observe: true, debounceMs: 5 });
    await session.flush();

    session.stop();
    appendTurn(doc, 4, "user", "REDACTED-USER-3");
    session.schedule();
    await sleep(60);

    expect(messages).toHaveLength(1);
  });
});

describe("signatureOf", () => {
  function success(): ExtractSuccess {
    return expectExtractSuccess(
      extractConversation(chatgptAdapter, {
        document: fixtureDocument(),
        url: CHATGPT_URL,
        title: "Redacted conversation",
        capturedAt: CAPTURED_AT,
      })
    );
  }

  it("is stable for an unchanged conversation", () => {
    expect(signatureOf(success())).toBe(signatureOf(success()));
  });

  it("changes when a message's text changes", () => {
    const original = success();
    const changed: ExtractSuccess = {
      ...original,
      conversation: {
        ...original.conversation,
        messages: original.conversation.messages.map((message, index) =>
          index === 0 ? { ...message, text: "REDACTED-USER-1 edited" } : message
        ),
      },
    };

    expect(signatureOf(changed)).not.toBe(signatureOf(original));
  });

  it("changes when an attachment is added", () => {
    const withAttachment = expectExtractSuccess(
      extractConversation(chatgptAdapter, {
        document: parseFixture(readFixture("chatgpt", "attachments.html")),
        url: CHATGPT_URL,
        capturedAt: CAPTURED_AT,
      })
    );

    expect(signatureOf(withAttachment)).not.toBe(signatureOf(success()));
  });

  it("treats the same failure code and slot as one failure, whatever the detail says", () => {
    const first: ExtractResult = {
      ok: false,
      code: "DOM_SHAPE_UNRECOGNIZED",
      detail: "landmark main missing",
      slot: "conversationRoot",
      rung: -1,
    };
    const second: ExtractResult = { ...first, detail: "landmark main missing again" };
    const otherSlot: ExtractResult = { ...first, slot: "turnContainer" };

    expect(signatureOf(second)).toBe(signatureOf(first));
    expect(signatureOf(otherSlot)).not.toBe(signatureOf(first));
  });
});
