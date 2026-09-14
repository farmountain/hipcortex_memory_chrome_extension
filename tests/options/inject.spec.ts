/**
 * The off state of context injection (task 8.10, G4.5).
 *
 * Task 8.10 asked for "`injectIntoAiChats` defaults to `false`, and no provider DOM node is mutated
 * while it is `false`". The setting is no longer unimplemented — the worker gates placement on it and
 * the page refuses to place while it is off — so the task's second half is now a property to keep
 * rather than a property to hope for, and the proofs change shape with it:
 *
 * 1. the default is `false` (a stored `true` could still exist from elsewhere);
 * 2. exactly one file reads the setting's value. A second reader is the moment the gate becomes
 *    advisory, and the page-side proof below would no longer be describing the shipped path;
 * 3. the **perception** layer — the adapters and the content script that walk a live page — writes
 *    nothing at all. The scan is scoped to those two trees deliberately: `src/inject/` writes by
 *    design, so including it would force this assertion to be loosened into meaninglessness. The
 *    injection tree's own narrower claim lives in `tests/quality/source-scans.spec.ts`;
 * 4. running every shipped adapter **and** a refused placement against a live document — the same
 *    `document` the page would be — leaves the serialised page byte-identical, with a positive
 *    control showing the same call does change the page once it is allowed to.
 */

import { describe, expect, it } from "vitest";

import { findViolations, pathsWith, scanSource } from "../helpers/scan.js";
import { readFixture } from "../helpers/fixtures.js";
import { allAdapters } from "../../src/capture/providers/registry.js";
import { placeContext } from "../../src/inject/place.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";

/** Anything that would change the page the user is looking at. */
const DOM_WRITE =
  /\.(innerHTML|outerHTML|textContent|innerText|value|style)\s*=|\.(appendChild|append|prepend|insertBefore|insertAdjacentHTML|insertAdjacentElement|replaceChild|removeChild|remove|setAttribute|removeAttribute|toggleAttribute|classList\.(add|remove|toggle)|click|focus)\s*\(|document\.(write|writeln|createElement|adoptNode)/;

const PERCEPTION_LAYER = ["src/capture/", "src/content/"];

function perceptionFiles() {
  return scanSource().filter((file) => PERCEPTION_LAYER.some((prefix) => file.path.startsWith(prefix)));
}

const LIVE_URL = "https://chatgpt.com/c/live-page";

function liveDocument(): string {
  document.body.innerHTML = new DOMParser().parseFromString(
    readFixture("chatgpt", "conversation.html"),
    "text/html"
  ).body.innerHTML;
  return document.documentElement.outerHTML;
}

describe("injectIntoAiChats is off, and one place decides — task 8.10", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.injectIntoAiChats).toBe(false);
  });

  it("names the setting in exactly the declaration, the options page and the gate", () => {
    // `types` declares it, `options` renders and saves it, `background` is the gate that reads it.
    // `src/inject/host.ts` mentions the name in a comment explaining why the page does not read it;
    // the next assertion is the one that would catch a comment turning into a reader.
    expect(pathsWith(scanSource(), /injectIntoAiChats/)).toEqual([
      "src/background.ts",
      "src/inject/host.ts",
      "src/options.ts",
      "src/types/index.ts",
    ]);
  });

  it("is read as a value by the worker alone, so the gate cannot be sidestepped", () => {
    expect(pathsWith(scanSource(), /settings\.injectIntoAiChats/)).toEqual(["src/background.ts"]);
  });

  it("has no DOM-writing call anywhere in the perception layer or the content script", () => {
    const violations = findViolations(perceptionFiles(), DOM_WRITE);

    expect(violations.map((violation) => `${violation.path}:${violation.line}: ${violation.text}`)).toEqual([]);
  });

  it("leaves a live provider page byte-identical after every adapter has read it", () => {
    const before = liveDocument();

    for (const adapter of allAdapters()) {
      adapter.extract({ document, url: LIVE_URL, capturedAt: "2025-01-15T00:00:00.000Z" });
    }

    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("leaves the live page byte-identical when a placement is refused for being switched off", () => {
    const before = liveDocument();

    const report = placeContext({
      document,
      url: LIVE_URL,
      enabled: false,
      text: "this must never reach the page",
    });

    expect(report.placed).toBe(false);
    expect(report.code).toBe("INJECTION_DISABLED");
    expect(document.documentElement.outerHTML).toBe(before);

    // The positive control: the same call, on the same document, allowed to run. Without it, "the
    // page did not change" would also be satisfied by a placement path that never changes anything.
    // Read back from the field rather than from `outerHTML`: jsdom serialises a `<textarea>` from its
    // default value, so a `value` write is real in the DOM and invisible in the markup.
    const allowed = placeContext({ document, url: LIVE_URL, enabled: true, text: "placed on purpose" });
    expect(allowed.placed).toBe(true);
    expect(allowed.wroteInto).toBe("value");
    expect((document.querySelector("form textarea") as HTMLTextAreaElement).value).toBe(
      "placed on purpose"
    );
  });
});
