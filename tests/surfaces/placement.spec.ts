/**
 * Placement-from-the-panel specs (tasks 2.3, 3.1, 3.4) — G4.5.
 *
 * Task 3.1 asks for placement "on an explicit user action". The action is here, on the record the
 * user is looking at: a local search hit carries the id of the record the core acknowledged, and the
 * button sends that id rather than any text, which is what anchors a placement to a record instead of
 * to a live page (design decision 4). The spec therefore asserts the **message** as well as the panel:
 * an id crosses the boundary, no captured text does.
 *
 * Task 2.3 asks that a refusal be surfaced rather than swallowed, and this is the surface that owes
 * it. Three refusals are checked because they are the three shapes a user has to tell apart: a
 * recognised code with a reason, a code whose reason came from the page, and a reply with no reason at
 * all — the case that renders as "undefined" in a panel that trusts its own inputs.
 *
 * Task 3.4 asks that truncation not be mistakable for the whole context, so the cut is asserted to
 * print both lengths, and the success line is asserted to say that nothing was sent — the one thing a
 * user could reasonably get wrong about a feature that writes into a box next to a Send button.
 */

import { describe, expect, it } from "vitest";

import { bootSurface } from "../helpers/surface.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import type { SearchResult } from "../../src/types/index.js";

const RECORD_ID = "rec-panel-1";
const CAPTURED_TEXT = "the kubernetes rollout stalled while the readiness probe was flapping";

const LOCAL_HIT: SearchResult = {
  source: "local",
  query: "kubernetes",
  count: 1,
  indexed: 3,
  unmatchedTokens: [],
  results: [
    {
      id: RECORD_ID,
      actor: "spec-actor",
      action: "captured",
      target: CAPTURED_TEXT,
      timestamp: "2025-01-15T00:00:00.000Z",
      provider: "claude",
    },
  ],
};

const CORE_HIT: SearchResult = {
  ...LOCAL_HIT,
  source: "core",
  indexed: undefined,
};

/** The side panel's own boot traffic plus the one route each test cares about. */
function replies(search: SearchResult, place: unknown) {
  return {
    GET_SETTINGS: () => ({ success: true, data: DEFAULT_SETTINGS }),
    HEALTH_CHECK: () => ({
      success: true,
      data: {
        health: { healthy: true, status: "ok" },
        resolution: { mode: "auto", active: "http", fellBack: false, detail: "http://127.0.0.1:3030/health" },
      },
    }),
    SEARCH_MEMORY: () => ({ success: true, data: search }),
    PLACE_CONTEXT: () => place,
  };
}

/** Click something, then let the handler's awaits run out. */
async function click(target: Element | null): Promise<void> {
  if (!target) throw new Error("nothing to click");
  target.dispatchEvent(new Event("click", { bubbles: true }));
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Search, then click the placement action on the first hit and hand back the note's text. */
async function placeFromSearch(
  search: SearchResult,
  place: unknown,
  options: { scope?: "local" | "core" } = {}
): Promise<{ note: string; button: HTMLButtonElement }> {
  await bootSurface("sidepanel", replies(search, place));

  if (options.scope) {
    (document.getElementById("search-scope") as HTMLSelectElement).value = options.scope;
  }
  (document.getElementById("query") as HTMLInputElement).value = "kubernetes";
  await click(document.getElementById("btn-search"));

  const button = document.querySelector(".result-place") as HTMLButtonElement | null;
  await click(button);

  return {
    note: document.querySelector(".result-note")?.textContent ?? "",
    button: document.querySelector(".result-place") as HTMLButtonElement,
  };
}

describe("the panel places captured context into the open chat — G4.5 (tasks 2.3, 3.1)", () => {
  it("sends the acknowledged record's id and no captured text at all", async () => {
    const mock = await bootSurface(
      "sidepanel",
      replies(LOCAL_HIT, { success: true, data: { placed: true, providerId: "gemini", placedChars: 60 } })
    );
    (document.getElementById("query") as HTMLInputElement).value = "kubernetes";
    await click(document.getElementById("btn-search"));
    await click(document.querySelector(".result-place"));

    const sent = mock.runtime.sendMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((message) => message["type"] === "PLACE_CONTEXT");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: "PLACE_CONTEXT", indexedId: RECORD_ID });
    // The text the record holds must not travel from the panel: the worker reads it from the index,
    // so the surface cannot be the side that decides what gets written into a page.
    expect(JSON.stringify(sent[0])).not.toContain("kubernetes rollout");
  });

  it("reports where the text went and that nothing was sent", async () => {
    const { note } = await placeFromSearch(LOCAL_HIT, {
      success: true,
      data: { placed: true, providerId: "gemini", placedChars: 60, sourceChars: 60, wroteInto: "value" },
    });

    expect(note).toContain("Placed 60 characters into gemini");
    expect(note).toContain("Nothing was sent");
  });

  it("prints both lengths when the context was shortened to fit", async () => {
    const { note } = await placeFromSearch(LOCAL_HIT, {
      success: true,
      data: {
        placed: true,
        providerId: "deepseek",
        placedChars: 1998,
        sourceChars: 5400,
        truncated: true,
        maxChars: 2000,
        wroteInto: "text",
      },
    });

    expect(note).toContain("the first 1998 of 5400 characters");
    expect(note).toContain("2000-character limit");
    expect(note).toContain("Nothing was sent");
  });

  it("shows the refusal's code and reason instead of looking like nothing happened", async () => {
    const { note, button } = await placeFromSearch(LOCAL_HIT, {
      success: false,
      data: {
        placed: false,
        code: "INJECTION_DISABLED",
        detail: "placing context into AI chats is turned off in the extension options",
      },
      error: "placing context into AI chats is turned off in the extension options",
    });

    expect(note).toContain("Not placed (INJECTION_DISABLED)");
    expect(note).toContain("turned off in the extension options");
    // The action is left usable: the user can turn the setting on and try the same record again.
    expect(button.disabled).toBe(false);
    // And the result itself is still on screen — a refusal is not a reason to hide what was searched.
    expect(document.querySelector(".result .target")?.textContent).toBe(CAPTURED_TEXT);
  });

  it("names a page refusal by the code the page chose", async () => {
    const { note } = await placeFromSearch(LOCAL_HIT, {
      success: false,
      data: {
        placed: false,
        code: "COMPOSER_AMBIGUOUS",
        detail: "two nodes matched the composer rung, so choosing one would be a guess",
      },
      error: "two nodes matched the composer rung, so choosing one would be a guess",
    });

    expect(note).toContain("COMPOSER_AMBIGUOUS");
    expect(note).toContain("would be a guess");
  });

  it("says so rather than rendering `undefined` when the worker gives no reason", async () => {
    const { note } = await placeFromSearch(LOCAL_HIT, { success: false });

    expect(note).toContain("Not placed (ERROR)");
    expect(note).toContain("did not report a reason");
    expect(note).not.toContain("undefined");
  });

  it("offers no action on a hit from the runtime's semantic search", async () => {
    await bootSurface("sidepanel", replies(CORE_HIT, { success: false, error: "not routed" }));
    (document.getElementById("search-scope") as HTMLSelectElement).value = "core";
    (document.getElementById("query") as HTMLInputElement).value = "kubernetes";
    await click(document.getElementById("btn-search"));

    // The index is what `PLACE_CONTEXT` resolves against, and a semantic hit may not be in it: the
    // panel does not offer an action whose answer would be `CONTEXT_NOT_FOUND` (G3.9).
    expect(document.querySelector(".result .target")?.textContent).toBe(CAPTURED_TEXT);
    expect(document.querySelector(".result-place")).toBeNull();
  });
});
