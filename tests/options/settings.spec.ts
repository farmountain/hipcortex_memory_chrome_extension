/**
 * Settings specs (task 8.9) — G2.7.
 *
 * G2.7: "conversation content never reaches `chrome.storage.sync`" — so this file asserts the split
 * by *lifetime*, not by name: durable configuration goes to `sync`, and an ephemeral handoff such as
 * `pendingSearch` goes to `session`. The two are asserted together with the same secret, because
 * "the key is absent" is a weaker claim than "the text is nowhere in `sync`".
 *
 * The transport-mode assertions (task 8.1) live here too: the mode is a setting, so "defaults fill
 * missing keys" and "the control round-trips the mode" are the same question asked of the worker and
 * of the page.
 */

import { describe, expect, it } from "vitest";

import { bootSurface, submitForm, textOf } from "../helpers/surface.js";
import { loadWorker } from "../helpers/worker.js";
import { installFetchMock, jsonBody } from "../helpers/http.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { DEFAULT_SETTINGS, TRANSPORT_MODES } from "../../src/types/index.js";
import type { ExtensionSettings } from "../../src/types/index.js";

const SECRET = "the selection text must never reach sync storage";

interface SentMessage {
  type?: string;
  settings?: Record<string, unknown>;
}

function sentMessages(mock: ChromeMock): SentMessage[] {
  return mock.runtime.sendMessage.mock.calls.map((call) => call[0] as SentMessage);
}

describe("settings defaults and merge", () => {
  it("fills every missing key from the defaults, including the transport mode", async () => {
    const { send } = await loadWorker();

    const { response } = await send({ type: "GET_SETTINGS" });

    expect(response.success).toBe(true);
    expect(response.data).toEqual(DEFAULT_SETTINGS);
    expect((response.data as ExtensionSettings).transportMode).toBe("auto");
    expect(TRANSPORT_MODES).toEqual(["auto", "consumer", "developer"]);
  });

  it("merges a partial stored setting over the defaults", async () => {
    const { send } = await loadWorker({ sync: { defaultActor: "alice" } });

    const { response } = await send({ type: "GET_SETTINGS" });

    expect(response.data).toEqual({ ...DEFAULT_SETTINGS, defaultActor: "alice" });
  });

  it("round-trips a save: what the reply reports is what a later read returns", async () => {
    const { mock, send } = await loadWorker();

    const saved = await send({
      type: "SAVE_SETTINGS",
      settings: { apiKey: "k-1", transportMode: "developer" } satisfies Partial<ExtensionSettings>,
    });
    const read = await send({ type: "GET_SETTINGS" });

    expect(saved.response.success).toBe(true);
    expect(saved.response.data).toEqual({ ...DEFAULT_SETTINGS, apiKey: "k-1", transportMode: "developer" });
    expect(read.response.data).toEqual(saved.response.data);
    expect(mock.storage.sync.data["transportMode"]).toBe("developer");
    // Saving one key must not erase the others: the merged read above already proves it, and this
    // pins it to what was persisted rather than to what was reported.
    expect(mock.storage.sync.data["apiUrl"]).toBe(DEFAULT_SETTINGS.apiUrl);
  });
});

describe("ephemeral handoff never enters sync — G2.7", () => {
  it("writes the pending search to session, keeps it out of sync, and opens the side panel", async () => {
    const { mock } = await loadWorker();
    const onClicked = mock.contextMenus.onClicked.addListener.mock.calls[0]?.[0] as (
      info: Record<string, unknown>,
      tab: Record<string, unknown>
    ) => void;
    expect(typeof onClicked).toBe("function");

    onClicked(
      { menuItemId: "hipcortex-search-selection", selectionText: SECRET, pageUrl: "https://example.com/p" },
      { windowId: 7, url: "https://example.com/p", title: "Example" }
    );
    for (let index = 0; index < 60; index += 1) await Promise.resolve();

    expect(mock.storage.session.data["pendingSearch"]).toBe(SECRET);
    expect(Object.keys(mock.storage.sync.data)).not.toContain("pendingSearch");
    expect(JSON.stringify(mock.storage.sync.data)).not.toContain(SECRET);
    expect(mock.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
  });
});

/**
 * The two context-menu items that write a record, and the two commands the manifest binds.
 *
 * The item above is asserted where the question is *where the text lands*; these ask a different
 * question — **what reaches the core** — so they read the request the recorder captured rather than
 * a storage key. The add path is `sendRecord`, so the assertion is on the wire body and not on an
 * internal call, which is the same reason `tests/router/import.spec.ts` asserts `recorder.urls()`.
 *
 * Together these are exactly the halves of task 8.12 that a browser cannot raise: the OS menu click
 * and the physical keystroke are raised by the browser chrome, above the renderer, so no CDP input
 * event can synthesise them. The handlers are ordinary code, and these drive them for real.
 *
 * `developer` is named rather than left on `auto` for the reason `tests/router/import.spec.ts`
 * gives: `auto` tries Native Messaging first and the chrome mock's port never answers, so the
 * measurement would be of a response timeout rather than of the menu item.
 */
describe("a context-menu capture reaches the core — G1.7 surface", () => {
  const ADD_URL = "http://127.0.0.1:3030/memory/add";
  const TAB = { id: 1, url: "https://example.com/p", title: "Example page", windowId: 7 };

  async function driveMenuItem(info: Record<string, unknown>, tab = TAB) {
    const recorder = installFetchMock(() => jsonBody({ success: true, record_id: "core-1" }));
    const { mock } = await loadWorker({
      sync: { ...DEFAULT_SETTINGS, transportMode: "developer", defaultActor: "menu-actor" },
    });
    const onClicked = mock.contextMenus.onClicked.addListener.mock.calls[0]?.[0] as (
      i: Record<string, unknown>,
      t: Record<string, unknown>
    ) => Promise<void>;
    expect(typeof onClicked).toBe("function");

    await onClicked(info, tab);

    const request = recorder.requests.find((candidate) => candidate.url === ADD_URL);
    return {
      urls: recorder.urls(),
      request,
      posted: request?.json as Record<string, unknown> | undefined,
    };
  }

  it("posts a selected passage as `selected`, carrying the page metadata", async () => {
    const { request, posted } = await driveMenuItem({
      menuItemId: "hipcortex-add-selection",
      selectionText: SECRET,
      pageUrl: "https://example.com/p",
    });

    expect(request?.method).toBe("POST");
    expect(posted).toMatchObject({
      actor: "menu-actor",
      action: "selected",
      target: SECRET,
      metadata: { url: "https://example.com/p", title: "Example page", source: "context-menu" },
    });
  });

  it("truncates a very long selection at 2000 characters", async () => {
    const { posted } = await driveMenuItem({
      menuItemId: "hipcortex-add-selection",
      selectionText: "s".repeat(2500),
      pageUrl: "https://example.com/p",
    });

    expect((posted?.["target"] as string).length).toBe(2000);
  });

  it("posts the page itself as `visited`, read from the tab rather than from the info", async () => {
    const { posted } = await driveMenuItem(
      { menuItemId: "hipcortex-add-page" },
      { ...TAB, url: "https://example.com/other", title: "Other page" }
    );

    expect(posted).toMatchObject({
      action: "visited",
      target: "Other page",
      metadata: { url: "https://example.com/other", title: "Other page", source: "context-menu-page" },
    });
  });

  it("sends nothing for the add-selection item when the click carried no selection text", async () => {
    const { urls } = await driveMenuItem({ menuItemId: "hipcortex-add-selection" });

    expect(urls).toEqual([]);
  });
});

describe("the keyboard commands the manifest binds", () => {
  const ADD_URL = "http://127.0.0.1:3030/memory/add";
  const ACTIVE = { id: 3, url: "https://example.com/p", title: "Example page", windowId: 7 };

  async function driveCommand(command: string, prepare?: (mock: ChromeMock) => void) {
    const recorder = installFetchMock(() => jsonBody({ success: true, record_id: "core-1" }));
    const { mock } = await loadWorker({
      sync: { ...DEFAULT_SETTINGS, transportMode: "developer", defaultActor: "command-actor" },
      tabs: { active: ACTIVE },
    });
    prepare?.(mock);

    const onCommand = mock.commands.onCommand.addListener.mock.calls[0]?.[0] as (
      c: string
    ) => Promise<void>;
    expect(typeof onCommand).toBe("function");

    await onCommand(command);

    const request = recorder.requests.find((candidate) => candidate.url === ADD_URL);
    return {
      urls: recorder.urls(),
      posted: request?.json as Record<string, unknown> | undefined,
      mock,
    };
  }

  it("opens the side panel on the active window and posts no record", async () => {
    const { mock, urls } = await driveCommand("open-side-panel");

    expect(mock.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
    // Opening a panel is not a capture. If this ever stops being true, the assertion above would
    // still pass and the extra write would go unnoticed, so it is pinned separately.
    expect(urls).toEqual([]);
  });

  it("posts the selection it reads from the active tab, marked `keyboard-shortcut`", async () => {
    const { posted } = await driveCommand("quick-add-memory", (mock) => {
      mock.scripting.executeScript.mockResolvedValue([{ result: SECRET }]);
    });

    expect(posted).toMatchObject({
      actor: "command-actor",
      action: "selected",
      target: SECRET,
      metadata: { url: "https://example.com/p", title: "Example page", source: "keyboard-shortcut" },
    });
  });

  it("posts nothing for quick-add when the page has no selection", async () => {
    const { urls } = await driveCommand("quick-add-memory");

    expect(urls).toEqual([]);
  });
});

describe("the transport mode control — task 8.1", () => {
  function optionsReplies(settings: Partial<ExtensionSettings>) {
    return {
      GET_SETTINGS: () => ({ success: true, data: { ...DEFAULT_SETTINGS, ...settings } }),
      SAVE_SETTINGS: (message: Record<string, unknown>) => ({
        success: true,
        data: { ...DEFAULT_SETTINGS, ...(message["settings"] ?? {}) },
      }),
    };
  }

  it("offers exactly the three modes the type declares", async () => {
    await bootSurface("options", optionsReplies({}));

    const select = document.getElementById("transportMode") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([...TRANSPORT_MODES]);
  });

  it("shows the saved mode and saves the chosen one", async () => {
    const mock = await bootSurface("options", optionsReplies({ transportMode: "consumer" }));
    const select = document.getElementById("transportMode") as HTMLSelectElement;
    expect(select.value).toBe("consumer");

    select.value = "developer";
    submitForm("settings-form");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saves = sentMessages(mock).filter((message) => message.type === "SAVE_SETTINGS");
    expect(saves).toHaveLength(1);
    expect(saves[0]?.settings?.["transportMode"]).toBe("developer");
  });

  it("shows the defaults when the worker reports nothing", async () => {
    await bootSurface("options", { GET_SETTINGS: () => ({ success: true, data: {} }) });

    expect((document.getElementById("apiUrl") as HTMLInputElement).value).toBe(DEFAULT_SETTINGS.apiUrl);
    expect((document.getElementById("transportMode") as HTMLSelectElement).value).toBe("auto");
    expect((document.getElementById("autoCapture") as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById("injectIntoAiChats") as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById("headroomMode") as HTMLInputElement).checked).toBe(true);
    expect(textOf("status")).toBe("");
  });
});
