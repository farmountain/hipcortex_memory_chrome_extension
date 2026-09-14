/**
 * Manual-capture specs (task 8.8).
 *
 * Task 8.8: "preserve manual-capture input on failure and surface the failure reason; add specs for
 * success clearing input and failure preserving it."
 *
 * The failure mode this guards against is the one that looks like success: a store that fails, an
 * input that is emptied, and a reason that appears for two seconds in a toast. The spec therefore
 * asserts the reason is still on screen *as text* after the surface has settled, not that a toast was
 * raised — and it asserts the draft is byte-identical, because a "helpful" trim or truncation would
 * still lose what the user typed.
 */

import { describe, expect, it } from "vitest";

import { bootSurface, textOf, isHidden } from "../helpers/surface.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";

const DRAFT = "a thought I do not want to retype";

function popupReplies(addMemory: unknown) {
  return {
    GET_SETTINGS: () => ({ success: true, data: DEFAULT_SETTINGS }),
    HEALTH_CHECK: () => ({
      success: true,
      data: {
        health: { healthy: true, status: "ok" },
        resolution: { mode: "auto", active: "http", fellBack: false, detail: "http://127.0.0.1:3030/health" },
      },
    }),
    CAPTURE_STATUS: () => ({
      success: true,
      data: {
        autoCapture: false,
        retention: { queued: 0, retrying: 0, refused: 0, paused: false, refusals: [], message: null },
        needsAttention: [],
        failures: 0,
      },
    }),
    ADD_MEMORY: () => addMemory,
  };
}

/** Click a button, then let the handler's awaits (including the status refresh) run out. */
async function click(id: string): Promise<void> {
  document.getElementById(id)?.dispatchEvent(new Event("click", { bubbles: true }));
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the popup keeps the draft when the store fails — task 8.8", () => {
  it("clears the field and the reason on success", async () => {
    await bootSurface("popup", popupReplies({ success: true, data: { id: "rec-1" } }));
    (document.getElementById("memory-text") as HTMLTextAreaElement).value = DRAFT;

    await click("btn-add");

    expect((document.getElementById("memory-text") as HTMLTextAreaElement).value).toBe("");
    expect(isHidden("add-error")).toBe(true);
  });

  it("keeps the exact draft and shows the reason on failure", async () => {
    await bootSurface("popup", popupReplies({ success: false, error: "the queue is paused" }));
    (document.getElementById("memory-text") as HTMLTextAreaElement).value = DRAFT;

    await click("btn-add");

    expect((document.getElementById("memory-text") as HTMLTextAreaElement).value).toBe(DRAFT);
    expect(isHidden("add-error")).toBe(false);
    expect(textOf("add-error")).toContain("the queue is paused");
    expect(textOf("add-error")).toMatch(/still here/);
  });

  it("says so rather than failing silently when the worker gives no reason", async () => {
    await bootSurface("popup", popupReplies({ success: false }));
    (document.getElementById("memory-text") as HTMLTextAreaElement).value = DRAFT;

    await click("btn-add");

    expect(textOf("add-error")).toContain("did not acknowledge");
    expect((document.getElementById("memory-text") as HTMLTextAreaElement).value).toBe(DRAFT);
  });

  it("refuses an empty draft without contacting the worker", async () => {
    const mock = await bootSurface("popup", popupReplies({ success: true, data: { id: "rec-1" } }));
    (document.getElementById("memory-text") as HTMLTextAreaElement).value = "   ";

    await click("btn-add");

    const types = mock.runtime.sendMessage.mock.calls.map((call) => String((call[0] as { type?: unknown })?.type));
    expect(types).not.toContain("ADD_MEMORY");
  });
});

describe("the side panel keeps the draft when the store fails — task 8.8", () => {
  function sidepanelReplies(addMemory: unknown) {
    return {
      GET_SETTINGS: () => ({ success: true, data: DEFAULT_SETTINGS }),
      HEALTH_CHECK: () => ({
        success: true,
        data: {
          health: { healthy: true, status: "ok" },
          resolution: { mode: "auto", active: "http", fellBack: false, detail: "http://127.0.0.1:3030/health" },
        },
      }),
      ADD_MEMORY: () => addMemory,
    };
  }

  it("clears the field and the reason on success", async () => {
    await bootSurface("sidepanel", sidepanelReplies({ success: true, data: { id: "rec-1" } }));
    (document.getElementById("capture") as HTMLTextAreaElement).value = DRAFT;

    await click("btn-capture");

    expect((document.getElementById("capture") as HTMLTextAreaElement).value).toBe("");
    expect(isHidden("capture-note")).toBe(true);
  });

  it("keeps the exact draft and shows the reason on failure", async () => {
    await bootSurface("sidepanel", sidepanelReplies({ success: false, error: "connection refused" }));
    (document.getElementById("capture") as HTMLTextAreaElement).value = DRAFT;

    await click("btn-capture");

    expect((document.getElementById("capture") as HTMLTextAreaElement).value).toBe(DRAFT);
    expect(isHidden("capture-note")).toBe(false);
    expect(textOf("capture-note")).toContain("connection refused");
    expect(textOf("capture-note")).toMatch(/still here/);
  });

  it("says so rather than failing silently when the worker gives no reason", async () => {
    await bootSurface("sidepanel", sidepanelReplies({ success: false }));
    (document.getElementById("capture") as HTMLTextAreaElement).value = DRAFT;

    await click("btn-capture");

    expect(textOf("capture-note")).toContain("did not acknowledge");
    expect((document.getElementById("capture") as HTMLTextAreaElement).value).toBe(DRAFT);
  });
});
