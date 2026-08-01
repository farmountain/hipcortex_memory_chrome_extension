import { DEFAULT_SETTINGS } from "./types.js";
import { HipCortexClient } from "./api-client.js";

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.sync.set(next);
  return next;
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "hipcortex-add-selection",
      title: "Add selection to HipCortex",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "hipcortex-add-page",
      title: "Add page to HipCortex",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "hipcortex-search-selection",
      title: "Search HipCortex for selection",
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await getSettings();
  const client = HipCortexClient.fromSettings(settings);

  if (info.menuItemId === "hipcortex-add-selection" && info.selectionText) {
    const record = {
      actor: settings.defaultActor,
      action: "selected",
      target: info.selectionText.slice(0, 2000),
      metadata: { url: info.pageUrl || tab?.url, title: tab?.title, source: "context-menu" },
    };
    try {
      await client.addMemory(record);
      await chrome.action.setBadgeText({ text: "✓" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
    } catch (e) {
      console.error("[HipCortex] add failed", e);
      await chrome.action.setBadgeText({ text: "!" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
    }
  }

  if (info.menuItemId === "hipcortex-add-page" && tab?.url) {
    const record = {
      actor: settings.defaultActor,
      action: "visited",
      target: tab.title || tab.url,
      metadata: { url: tab.url, title: tab.title, source: "context-menu-page" },
    };
    try {
      await client.addMemory(record);
      await chrome.action.setBadgeText({ text: "✓" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
    } catch (e) {
      console.error("[HipCortex] add page failed", e);
    }
  }

  if (info.menuItemId === "hipcortex-search-selection" && info.selectionText) {
    if (tab?.windowId && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      await chrome.storage.session.set({ pendingSearch: info.selectionText });
    }
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "open-side-panel") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  }
  if (command === "quick-add-memory") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() || "",
      });
      if (result && typeof result === "string" && result.trim()) {
        const settings = await getSettings();
        const client = HipCortexClient.fromSettings(settings);
        await client.addMemory({
          actor: settings.defaultActor,
          action: "selected",
          target: result.trim().slice(0, 2000),
          metadata: { url: tab.url, title: tab.title, source: "keyboard-shortcut" },
        });
        await chrome.action.setBadgeText({ text: "✓" });
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
      }
    } catch (e) {
      console.error("[HipCortex] quick-add failed", e);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "GET_SETTINGS": {
          const settings = await getSettings();
          sendResponse({ success: true, data: settings });
          break;
        }
        case "SAVE_SETTINGS": {
          const settings = await saveSettings(message.settings);
          sendResponse({ success: true, data: settings });
          break;
        }
        case "HEALTH_CHECK": {
          const settings = await getSettings();
          const client = HipCortexClient.fromSettings(settings);
          const health = await client.health();
          sendResponse({ success: true, data: health });
          break;
        }
        case "ADD_MEMORY": {
          const settings = await getSettings();
          const client = HipCortexClient.fromSettings(settings);
          const result = await client.addMemory(message.record);
          sendResponse({ success: true, data: result });
          break;
        }
        case "SEARCH_MEMORY": {
          const settings = await getSettings();
          const client = HipCortexClient.fromSettings(settings);
          const result = await client.search(message.query, message.limit ?? 10);
          sendResponse({ success: true, data: result });
          break;
        }
        case "QUICK_ADD_SELECTION": {
          const settings = await getSettings();
          const client = HipCortexClient.fromSettings(settings);
          const record = {
            actor: settings.defaultActor,
            action: "selected",
            target: message.text.slice(0, 2000),
            metadata: { url: message.url, title: message.title, source: "popup-or-content" },
          };
          const result = await client.addMemory(record);
          sendResponse({ success: true, data: result });
          break;
        }
        default:
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendResponse({ success: false, error: msg });
    }
  })();
  return true;
});

console.log("[HipCortex] Background service worker ready");
