/**
 * "Capture this conversation" in both surfaces — G1.12, G1.13.
 *
 * The gap this closes was not a missing capability, it was a missing *door*: full-thread capture
 * existed only inside the passive path, so a user with the passive switch off had no way to ask for
 * the conversation in front of them, and a user who had it on could not tell whether anything had
 * happened. Two things are therefore asserted about the click, not one:
 *
 * 1. it reaches the worker as `CAPTURE_ACTIVE_TAB` — the message that runs a `manual` trigger, the one
 *    capture path the passive setting deliberately does not gate; and
 * 2. it leaves a sentence on screen that a person can act on, in all three outcomes, with the
 *    "kept here, will be retried" case never worded as "Stored."
 *
 * The third assertion is the one that would have caught the original bug: whatever the worker says,
 * the surface must not report a capture the runtime has not acknowledged as a completed one.
 *
 * The popup and the side panel are both driven from their **shipped** markup, read from disk by
 * `bootSurface`, so a control that exists in a controller but not in the packaged HTML fails here.
 */

import { describe, expect, it } from "vitest";

import { bootSurface, isHidden, textOf } from "../helpers/surface.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";

const CAPTURED = {
  success: true,
  data: { captured: true, providerId: "chatgpt", url: "https://chatgpt.com/c/1", messages: 12 },
};

const KEPT = {
  success: true,
  data: {
    captured: true,
    code: "NOT_ACKNOWLEDGED",
    providerId: "claude",
    url: "https://claude.ai/chat/1",
    messages: 4,
    detail: "Kept here — the runtime has not acknowledged it yet, so it will be retried.",
  },
};

const REFUSED = {
  success: false,
  error:
    "The conversation could not be read (DOM_SHAPE_UNRECOGNIZED): no landmark matched the turn container.",
  data: { captured: false, code: "EXTRACTION_FAILED", providerId: "chatgpt", url: "https://chatgpt.com/c/1" },
};

const DENIED = {
  success: false,
  error: "This site is not one HipCortex is allowed to read. Open the options page to allow it.",
  data: {
    captured: false,
    code: "SITE_ACCESS_DENIED",
    providerId: "chatgpt",
    url: "https://chatgpt.com/c/1",
  },
};

/**
 * Canned worker replies, with the passive setting held in a mutable box.
 *
 * The box is the point: `SAVE_SETTINGS` changes it and `CAPTURE_STATUS` reports it, so a surface that
 * writes the setting and then re-reads it is exercising a worker that remembers the write. A constant
 * reply would let a controller that ignores its own write — and simply re-renders the old value — look
 * correct in the spec and wrong in the browser.
 */
function replies(capture: unknown, initialAutoCapture = true) {
  const state = { autoCapture: initialAutoCapture };

  return {
    GET_SETTINGS: () => ({
      success: true,
      data: { ...DEFAULT_SETTINGS, autoCapture: state.autoCapture },
    }),
    SAVE_SETTINGS: (message: Record<string, unknown>) => {
      const settings = message["settings"] as Record<string, unknown>;
      if (typeof settings?.["autoCapture"] === "boolean") state.autoCapture = settings["autoCapture"];
      return { success: true, data: { ...DEFAULT_SETTINGS, autoCapture: state.autoCapture } };
    },
    HEALTH_CHECK: () => ({
      success: true,
      data: {
        health: { healthy: true, status: "ok" },
        resolution: {
          mode: "auto",
          active: "http",
          fellBack: false,
          detail: "http://127.0.0.1:3030/health",
        },
      },
    }),
    CAPTURE_STATUS: () => ({
      success: true,
      data: {
        autoCapture: state.autoCapture,
        retention: { queued: 0, retrying: 0, refused: 0, paused: false, refusals: [], message: null },
        needsAttention: [],
        failures: 0,
      },
    }),
    SEARCH_INDEX_STATUS: () => ({
      success: true,
      data: { entries: 0, providers: [], built: false, byteSize: 0 },
    }),
    CAPTURE_ACTIVE_TAB: () => capture,
  };
}

/** Click an element and let the handler's awaits — including the status refresh — run out. */
async function click(id: string): Promise<void> {
  document.getElementById(id)?.dispatchEvent(new Event("click", { bubbles: true }));
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The same, for a checkbox's `change` event rather than a click. */
async function toggle(id: string, checked: boolean): Promise<void> {
  const box = document.getElementById(id) as HTMLInputElement;
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the popup captures the conversation in front of you — G1.12", () => {
  it("asks the worker for the active tab's conversation, and never for a passive update", async () => {
    const mock = await bootSurface("popup", replies(CAPTURED));
    await click("btn-capture-conversation");

    const types = mock.runtime.sendMessage.mock.calls.map(
      (call) => (call[0] as Record<string, unknown>)["type"]
    );
    expect(types).toContain("CAPTURE_ACTIVE_TAB");
    // `CAPTURE_UPDATE` is the passive message a content script sends. A surface that sent it would be
    // impersonating a page rather than asking the worker to read one.
    expect(types).not.toContain("CAPTURE_UPDATE");
  });

  it("says what was stored and how much of it", async () => {
    await bootSurface("popup", replies(CAPTURED));
    await click("btn-capture-conversation");

    const note = textOf("conversation-capture-note");
    expect(note).toContain("12 messages");
    expect(note).toContain("chatgpt");
    expect(note).toContain("Stored.");
    expect(isHidden("conversation-capture-note")).toBe(false);
  });

  it("marks a stored capture as ok, not as pending", async () => {
    await bootSurface("popup", replies(CAPTURED));
    await click("btn-capture-conversation");

    const note = document.getElementById("conversation-capture-note")!;
    expect(note.classList.contains("ok")).toBe(true);
    expect(note.classList.contains("pending")).toBe(false);
    expect(note.classList.contains("err")).toBe(false);
  });

  it("never calls an unacknowledged capture stored — G2.9", async () => {
    await bootSurface("popup", replies(KEPT));
    await click("btn-capture-conversation");

    const note = textOf("conversation-capture-note");
    // The word a user reads as "it worked, the memory is in the system". For a queued conversation it
    // is not true yet, and saying it is what made the original product look like it did nothing.
    expect(note).not.toContain("Stored.");
    expect(note).toMatch(/retried/i);
    expect(note).toMatch(/nothing was lost/i);

    const node = document.getElementById("conversation-capture-note")!;
    expect(node.classList.contains("pending")).toBe(true);
    expect(node.classList.contains("err")).toBe(false);
  });

  it("reports a typed extraction failure with its code and the worker's reason", async () => {
    await bootSurface("popup", replies(REFUSED));
    await click("btn-capture-conversation");

    const note = textOf("conversation-capture-note");
    // The failure the follow-up work needs: a named code and the sentence that came with it, so the
    // next iteration has something to debug instead of a silent no-op.
    expect(note).toContain("EXTRACTION_FAILED");
    expect(note).toContain("DOM_SHAPE_UNRECOGNIZED");
    expect(document.getElementById("conversation-capture-note")!.classList.contains("err")).toBe(true);
  });

  it("reports a refused site as a refusal, not as an empty conversation", async () => {
    await bootSurface("popup", replies(DENIED));
    await click("btn-capture-conversation");

    const note = textOf("conversation-capture-note");
    expect(note).toContain("SITE_ACCESS_DENIED");
    expect(note).toMatch(/allow/i);
  });

  it("leaves the button usable after a failure", async () => {
    await bootSurface("popup", replies(REFUSED));
    await click("btn-capture-conversation");

    expect((document.getElementById("btn-capture-conversation") as HTMLButtonElement).disabled).toBe(
      false
    );
  });
});

describe("the popup's passive switch is a switch — G1.13", () => {
  it("shows the stored setting rather than a guess", async () => {
    await bootSurface("popup", replies(CAPTURED, true));
    expect((document.getElementById("capture-toggle") as HTMLInputElement).checked).toBe(true);

    await bootSurface("popup", replies(CAPTURED, false));
    expect((document.getElementById("capture-toggle") as HTMLInputElement).checked).toBe(false);
  });

  it("sends only the setting it changed", async () => {
    const mock = await bootSurface("popup", replies(CAPTURED, true));
    await toggle("capture-toggle", false);

    const save = mock.runtime.sendMessage.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)["type"] === "SAVE_SETTINGS"
    );
    expect(save).toBeDefined();
    const settings = (save![0] as Record<string, unknown>)["settings"] as Record<string, unknown>;
    /**
     * Exact object equality on purpose. `saveSettings` merges into the stored settings, so sending a
     * whole settings object from here would let a stale copy of `apiUrl` overwrite a newer one — and
     * could trip the off-machine confirmation for a change the user never made.
     */
    expect(Object.keys(settings)).toEqual(["autoCapture"]);
    expect(settings["autoCapture"]).toBe(false);
  });

  it("tells the user what turning it off still leaves them", async () => {
    await bootSurface("popup", replies(CAPTURED, true));
    await toggle("capture-toggle", false);

    const note = textOf("capture-toggle-note");
    expect(note).toMatch(/Nothing is captured automatically/i);
    // The reassurance that matters: the action they just found is not the one they just switched off.
    expect(note).toMatch(/still captures/i);
  });

  it("does not name any provider, so the manifest stays the only list", async () => {
    await bootSurface("popup", replies(CAPTURED, true));
    const notes = `${textOf("capture-toggle-note")} ${textOf("conversation-capture-note")}`;
    for (const provider of ["chatgpt", "claude", "gemini", "grok", "deepseek"]) {
      expect(notes.toLowerCase()).not.toContain(provider);
    }
  });
});

describe("the side panel offers the same click — G1.13", () => {
  it("asks for the active tab's conversation", async () => {
    const mock = await bootSurface("sidepanel", replies(CAPTURED));
    await click("btn-capture-conversation");

    const types = mock.runtime.sendMessage.mock.calls.map(
      (call) => (call[0] as Record<string, unknown>)["type"]
    );
    expect(types).toContain("CAPTURE_ACTIVE_TAB");
  });

  it("describes the outcome in the same three states as the popup", async () => {
    await bootSurface("sidepanel", replies(CAPTURED));
    await click("btn-capture-conversation");
    expect(textOf("conversation-capture-note")).toContain("Stored.");

    await bootSurface("sidepanel", replies(KEPT));
    await click("btn-capture-conversation");
    const kept = textOf("conversation-capture-note");
    expect(kept).not.toContain("Stored.");
    expect(kept).toMatch(/retried/i);

    await bootSurface("sidepanel", replies(REFUSED));
    await click("btn-capture-conversation");
    expect(textOf("conversation-capture-note")).toContain("DOM_SHAPE_UNRECOGNIZED");
    expect(document.getElementById("conversation-capture-note")!.classList.contains("err")).toBe(true);
  });

  it("starts hidden, so an idle panel is not showing a stale result", async () => {
    await bootSurface("sidepanel", replies(CAPTURED));
    expect(isHidden("conversation-capture-note")).toBe(true);
  });
});
