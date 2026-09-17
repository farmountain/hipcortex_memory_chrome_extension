/**
 * The badge and the first run — G1.11.
 *
 * Two mechanisms, one subject: a user must be able to tell, without opening anything, whether the
 * extension is allowed to read their AI chats, and a new user must be told that the choice exists.
 * Before this, a fresh install was silent. It captured nothing because no site was allowed, and it said
 * nothing about that — which reads as a broken extension, not as a question waiting to be answered.
 *
 * The badge is therefore a standing claim about the current state rather than an event marker, and the
 * first-run page opens on `install` only. Both properties are asserted here, plus the one that keeps
 * the badge honest: when the browser will not answer the permission question at all, the badge is left
 * alone instead of being set to "everything is fine".
 *
 * `restoreBadge` runs at module scope, so every load below has already triggered it before the first
 * assertion — the drain in `settle()` is what makes its `await`s observable.
 */

import { describe, expect, it, vi } from "vitest";

import { loadWorker } from "../helpers/worker.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import type { ChromeMock, ChromeMockOptions, EventMock } from "../helpers/chrome-mock.js";

const ACTOR = "spec-actor";

function options(permissions: ChromeMockOptions["permissions"]): ChromeMockOptions {
  return {
    sync: { ...DEFAULT_SETTINGS, defaultActor: ACTOR, transportMode: "developer" },
    permissions,
  };
}

/** Let the worker's unawaited module-scope `restoreBadge()` finish. */
async function settle(): Promise<void> {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** The last value passed to a badge call, or `undefined` if it was never called. */
function lastArg(mock: ChromeMock, fn: ChromeMock["action"]["setBadgeText"]): unknown {
  const calls = fn.mock.calls;
  return calls.length === 0 ? undefined : calls[calls.length - 1]?.[0];
}

function fire(event: EventMock, ...args: unknown[]): void {
  const listener = event.addListener.mock.calls[0]?.[0] as ((...a: unknown[]) => void) | undefined;
  listener?.(...args);
}

describe("the toolbar badge states whether every site is allowed — G1.11", () => {
  it("shows nothing at all once every declared origin is allowed", async () => {
    const { mock } = await loadWorker(
      options({ contains: () => false, granted: [...((await import("../helpers/chrome-mock.js")).shippedManifest().optional_host_permissions ?? [])] })
    );
    await settle();

    // Silence is the good state: a permanent marker on a healthy install is noise, and noise is what
    // makes a real warning invisible.
    expect(lastArg(mock, mock.action.setBadgeText)).toEqual({ text: "" });
  });

  it("shows an exclamation with a warning colour while any site is still refused", async () => {
    const { mock } = await loadWorker(options({ contains: () => false, granted: [] }));
    await settle();

    const text = lastArg(mock, mock.action.setBadgeText) as { text: string };
    expect(text.text).toBe("!");
    expect(lastArg(mock, mock.action.setBadgeBackgroundColor)).toEqual({ color: "#b45309" });
  });

  it("says in the tooltip how many need allowing and what to do about it", async () => {
    const { mock } = await loadWorker(options({ contains: () => false, granted: [] }));
    await settle();

    const title = lastArg(mock, mock.action.setTitle) as { title: string };
    expect(title.title).toMatch(/not allowed yet/i);
    expect(title.title).toMatch(/click to allow/i);
    // A count, not just "some": "3 of your AI chat sites" is checkable by the user, "some" is not.
    expect(title.title).toMatch(/\d+ of your AI chat sites/i);
  });

  it("lets the unpacked install's dim `contains` answer pass, because `getAll` agrees", async () => {
    /**
     * The trap this covers, measured on a real unpacked build: Chrome grants the declared origins, so
     * `getAll` lists all six, while `contains` answers `false` for every one of them. A badge driven by
     * `contains` alone would sit at `!` forever on a build that captures perfectly — and would send the
     * user to a permission prompt that is already granted.
     */
    const manifest = (await import("../helpers/chrome-mock.js")).shippedManifest();
    const { mock } = await loadWorker(
      options({ contains: () => false, granted: manifest.optional_host_permissions ?? [] })
    );
    await settle();

    expect(lastArg(mock, mock.action.setBadgeText)).toEqual({ text: "" });
  });

  it("treats an unanswerable permission query as not allowed, not as an all clear", async () => {
    const { mock } = await loadWorker(options({ contains: () => false, granted: [] }));
    await settle();

    mock.action.setBadgeText.mockClear();
    mock.permissions.contains = vi.fn(async () => {
      throw new Error("permission query unavailable");
    }) as unknown as ChromeMock["permissions"]["contains"];
    mock.permissions.getAll = vi.fn(async () => {
      throw new Error("permission query unavailable");
    }) as unknown as ChromeMock["permissions"]["getAll"];

    fire(mock.permissions.onAdded);
    await settle();

    /**
     * The asymmetry is the point. "I could not ask" must not be rendered as "everything is allowed":
     * that is the claim that leaves a user with an extension that reads nothing and says nothing, which
     * is the exact complaint this whole change set answers. `!` is the direction that can only be
     * over-cautious, and the options page corrects it in one glance.
     */
    expect((lastArg(mock, mock.action.setBadgeText) as { text: string }).text).toBe("!");
  });

  it("re-reads the state when the browser reports a grant, and again on a revoke", async () => {
    const { mock } = await loadWorker(options({ contains: () => false, granted: [] }));
    await settle();
    expect((lastArg(mock, mock.action.setBadgeText) as { text: string }).text).toBe("!");

    const manifest = (await import("../helpers/chrome-mock.js")).shippedManifest();
    mock.permissions.contains = vi.fn(() => true) as unknown as ChromeMock["permissions"]["contains"];
    mock.permissions.getAll = vi.fn(async () => ({
      origins: [...(manifest.optional_host_permissions ?? [])],
    })) as unknown as ChromeMock["permissions"]["getAll"];

    fire(mock.permissions.onAdded, { origins: manifest.optional_host_permissions });
    await settle();
    expect(lastArg(mock, mock.action.setBadgeText)).toEqual({ text: "" });

    mock.permissions.contains = vi.fn(() => false) as unknown as ChromeMock["permissions"]["contains"];
    mock.permissions.getAll = vi.fn(async () => ({ origins: [] })) as unknown as ChromeMock["permissions"]["getAll"];

    fire(mock.permissions.onRemoved, { origins: manifest.optional_host_permissions });
    await settle();
    expect((lastArg(mock, mock.action.setBadgeText) as { text: string }).text).toBe("!");
  });
});

describe("the first run opens the page that asks the question — G1.11", () => {
  it("opens the options page on install, so the choice is presented rather than assumed", async () => {
    const { mock } = await loadWorker(options({ contains: () => false, granted: [] }));

    fire(mock.runtime.onInstalled, { reason: "install" });
    await settle();

    expect(mock.tabs.create).toHaveBeenCalledTimes(1);
    const arg = mock.tabs.create.mock.calls[0]?.[0] as { url: string };
    expect(arg.url).toMatch(/options\.html$/);
  });

  it("does not steal a tab on update", async () => {
    const { mock } = await loadWorker(options({ contains: () => false, granted: [] }));

    fire(mock.runtime.onInstalled, { reason: "update" });
    await settle();

    // Someone updating has already answered this question. Opening the page again would take a tab
    // from them every release to re-ask it.
    expect(mock.tabs.create).not.toHaveBeenCalled();
  });

  it("re-states the badge after an install, because the answer may still be no", async () => {
    const { mock } = await loadWorker(options({ contains: () => false, granted: [] }));
    await settle();
    mock.action.setBadgeText.mockClear();

    fire(mock.runtime.onInstalled, { reason: "install" });
    await settle();

    expect((lastArg(mock, mock.action.setBadgeText) as { text: string }).text).toBe("!");
  });
});
