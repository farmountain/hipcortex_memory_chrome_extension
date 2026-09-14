/**
 * Surface mounting for the UI specs (tasks 8.2 – 8.10).
 *
 * Every spec here drives the **shipped** document: `mountSurface` reads `public/*.html` and installs
 * its `<body>` into the live jsdom document, and `bootSurface` imports the shipped controller so its
 * `DOMContentLoaded` handler runs. A spec that re-typed the markup would pass while the packaged
 * extension was broken — the exact failure mode `scripts/copy-assets.js` exists to prevent — so the
 * markup is read from disk rather than restated.
 *
 * Two jsdom facts shape this helper:
 *
 * 1. `DOMContentLoaded` has already fired by the time a spec runs, so a controller's listener only
 *    fires if the event is dispatched again;
 * 2. one jsdom document is shared by every test in a file, so a listener registered by an earlier
 *    boot survives into the next test and would run against markup it does not own. `bootSurface`
 *    therefore removes the listeners captured from previous boots before importing the next
 *    controller.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";

import { PUBLIC_DIR } from "./scan.js";
import { installChromeMock } from "./chrome-mock.js";
import type { ChromeMock, ChromeMockOptions } from "./chrome-mock.js";

export type SurfaceName = "popup" | "sidepanel" | "options";

/** The `<body>` of the shipped documents, read from disk — never restated in a spec. */
export function readSurfaceHtml(name: SurfaceName): string {
  const file = path.join(PUBLIC_DIR, `${name}.html`);
  return readFileSync(file, "utf8");
}

/** Install a surface's shipped body markup as the live document. */
export function mountSurface(name: SurfaceName): void {
  const parsed = new DOMParser().parseFromString(readSurfaceHtml(name), "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
}

/** jsdom already fired `DOMContentLoaded`; re-dispatch so the controller's listener runs. */
export function signalReady(): void {
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

/**
 * Drain the microtask queue.
 *
 * The controllers await several storage-backed replies in sequence, and the mock resolves those in
 * microtasks. A macrotask turn at the end catches anything scheduled through `setTimeout` (the
 * badge's 2 s timer is left alone on purpose — one 0 ms turn only lets already-due work run).
 */
export async function settle(rounds = 60): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export type ReplyFactory = (message: Record<string, unknown>) => unknown;

/**
 * Route `chrome.runtime.sendMessage` to canned replies, the way the worker would.
 *
 * The reply arrives through the callback, so the surface's promise-wrapping `send()` is exercised
 * rather than bypassed, and a message with no canned reply resolves to a typed failure instead of
 * `undefined` — a spec that forgot to route a message must not look like a surface that silently
 * ignored one.
 */
export function installReplyRouter(mock: ChromeMock, replies: Record<string, ReplyFactory>): void {
  const sendMessage = vi.fn((message: unknown, callback?: (reply: unknown) => void) => {
    const record = (message ?? {}) as Record<string, unknown>;
    const type = String(record["type"]);
    const factory = replies[type];
    const reply = factory ? factory(record) : { success: false, error: `spec did not route ${type}` };
    if (callback) queueMicrotask(() => callback(reply));
    return Promise.resolve(reply);
  });
  mock.runtime.sendMessage = sendMessage as unknown as ChromeMock["runtime"]["sendMessage"];
}

/** Listeners captured from previous boots, so they can be removed before the next mount. */
const registered: EventListener[] = [];

function forgetPreviousListeners(): void {
  for (const listener of registered.splice(0)) {
    document.removeEventListener("DOMContentLoaded", listener);
  }
}

/**
 * Mount a surface, install the chrome mock, and run the shipped controller against it.
 *
 * `vi.resetModules()` is what lets one spec file cover several surfaces: each boot gets a fresh
 * module instance whose listener binds to the mock installed for that boot.
 */
export async function bootSurface(
  name: SurfaceName,
  replies: Record<string, ReplyFactory>,
  options: ChromeMockOptions = {}
): Promise<ChromeMock> {
  forgetPreviousListeners();

  const mock = installChromeMock(options);
  installReplyRouter(mock, replies);
  mountSurface(name);

  vi.resetModules();
  const original = document.addEventListener;
  const spy = vi.spyOn(document, "addEventListener").mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    listenerOptions?: boolean | AddEventListenerOptions
  ) => {
    if (type === "DOMContentLoaded" && typeof listener === "function") {
      registered.push(listener as EventListener);
    }
    original.call(document, type, listener, listenerOptions);
  }) as typeof document.addEventListener);

  try {
    if (name === "popup") await import("../../src/popup.js");
    else if (name === "sidepanel") await import("../../src/sidepanel.js");
    else await import("../../src/options.js");
  } finally {
    spy.mockRestore();
  }

  signalReady();
  await settle();
  return mock;
}

/** Fire a form's submit handler the way a click on its submit button would. */
export function submitForm(id: string): void {
  const form = document.getElementById(id);
  if (!form) throw new Error(`no #${id} in the mounted surface`);
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

/** The visible text of an element, or a failure naming the element that was looked for. */
export function textOf(id: string): string {
  const element = document.getElementById(id);
  if (!element) throw new Error(`no #${id} in the mounted surface`);
  return (element.textContent ?? "").trim();
}

/** Whether an element carries the `hidden` class the CSS uses to keep it out of the layout. */
export function isHidden(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) throw new Error(`no #${id} in the mounted surface`);
  return element.classList.contains("hidden");
}
