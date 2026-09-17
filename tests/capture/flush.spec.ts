/**
 * The content script's answer to "Capture this conversation" — G1.12.
 *
 * What these specs are really pinning down is that the *user's* click is not subject to the rules the
 * passive path needs. The passive path sends nothing when a settled mutation changed nothing, because
 * otherwise a typing cursor would emit one failed capture per frame. That rule is correct there and
 * wrong here: a user who presses a capture button on a page that has not changed since a moment ago is
 * asking for this conversation, and "unchanged" is not an answer to that question.
 *
 * So the interesting assertions are the two negative ones — `capture()` does not consult the signature
 * and does not send — plus the fact that reading a page this extension does not watch is a typed
 * `unsupported` rather than a throw. The passive path's own specs (`tests/capture/content.spec.ts`)
 * are the other half of the contract and are not restated here.
 */

import { describe, expect, it } from "vitest";

import { parseFixture, readFixture } from "../helpers/fixtures.js";
import { startContentCapture } from "../../src/content/entry.js";
import type { ContentSession } from "../../src/content/entry.js";
import type { MessageType } from "../../src/types/index.js";

const CHATGPT_URL = "https://chatgpt.com/c/redacted";
const CAPTURED_AT = "2025-01-15T00:00:00.000Z";

function fixtureDocument(): Document {
  return parseFixture(readFixture("chatgpt", "conversation.html"));
}

/** A session that never sends anywhere: the manual path must not depend on a send existing. */
function session(options: { readonly url?: string; readonly doc?: Document } = {}): {
  readonly session: ContentSession;
  readonly sent: MessageType[];
} {
  const sent: MessageType[] = [];
  const started = startContentCapture({
    url: () => options.url ?? CHATGPT_URL,
    doc: () => options.doc ?? fixtureDocument(),
    observe: false,
    now: () => new Date(CAPTURED_AT),
    send: async (message) => {
      sent.push(message);
      return { success: true };
    },
  });
  return { session: started, sent };
}

describe("the user's own capture, on a page this extension reads — G1.12", () => {
  it("returns the conversation the adapter read", () => {
    const { session: started } = session();

    const reply = started.capture();

    expect(reply.status).toBe("captured");
    if (reply.status !== "captured") throw new Error("expected a capture");
    expect(reply.providerId).toBe("chatgpt");
    expect(reply.url).toBe(CHATGPT_URL);
    expect(reply.result.ok).toBe(true);
  });

  it("sends nothing, because the worker owns what happens to a capture", () => {
    const { session: started, sent } = session();

    started.capture();

    // A page that forwarded its own capture would be a second, unvalidated path into the pipeline.
    expect(sent).toEqual([]);
  });

  it("does not advance the passive path's signature", async () => {
    const { session: started } = session();

    started.capture();
    const passive = await started.flush();

    /**
     * The manual read must leave the passive path's bookkeeping untouched. If it advanced the
     * signature, a user who pressed the button and then sent a message would find their next message
     * silently not captured — the manual click would have consumed the "changed" state that the
     * passive path was going to act on.
     */
    expect(passive.status).toBe("sent");
  });

  it("reads the page again even when nothing has changed since the last capture", () => {
    const { session: started } = session();

    const first = started.capture();
    const second = started.capture();

    expect(first.status).toBe("captured");
    expect(second.status).toBe("captured");
    if (second.status !== "captured") throw new Error("expected a capture");
    expect(second.result.ok).toBe(true);
  });
});

describe("the user's own capture, when it cannot produce a conversation — G1.12", () => {
  it("reports a page this extension does not read as unsupported, not as an error", () => {
    const { session: started } = session({ url: "https://example.com/chat" });

    const reply = started.capture();

    // `unsupported` is a fact about the page, not a failure of the extension, and the two need
    // different words at the surface. A throw here would lose that distinction.
    expect(reply).toEqual({ status: "unsupported", url: "https://example.com/chat" });
  });

  it("carries the adapter's own typed failure through unchanged", () => {
    // An empty document is a page the adapter recognises and cannot read: the shape is right, the
    // turns are not there. That is `EMPTY_CONVERSATION` or a slot failure, and either way the code
    // must survive the trip to the surface that has to show it.
    const { session: started } = session({ doc: parseFixture("<!DOCTYPE html><html><body></body></html>") });

    const reply = started.capture();

    expect(reply.status).toBe("failed");
    if (reply.status !== "failed") throw new Error("expected a failure");
    expect(reply.providerId).toBe("chatgpt");
    expect(typeof reply.code).toBe("string");
    expect(reply.code.length).toBeGreaterThan(0);
    expect(reply.detail.length).toBeGreaterThan(0);
  });
});
