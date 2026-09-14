/**
 * HipCortex Chrome Extension — Background Service Worker
 * Layer 7 Harness + Layer 5 Planning: message router, context menus, commands
 */

import type {
  CaptureStatus,
  ExtensionSettings,
  HealthReport,
  ImportReport,
  MessageType,
  MessageResponse,
  MemoryRecord,
  PlaceContextReport,
  SearchIndexReport,
  SearchIndexStatus,
  SearchResult,
} from "./types/index.js";
import { DEFAULT_SETTINGS } from "./types/index.js";
import { createTransport } from "./api/transport/index.js";
import type { SendResult } from "./api/transport/index.js";
import { isLoopbackUrl } from "./api/transport/endpoints.js";
import { runCapturePipeline } from "./capture/pipeline.js";
import type { PipelineOutcome } from "./capture/pipeline.js";
import { installLifecycle } from "./capture/lifecycle.js";
import { retentionState, readQueue } from "./capture/queue/queue.js";
import { exportQueue } from "./capture/queue/export.js";
import { clearIndex, indexProviders, indexSize, readIndex, searchIndex } from "./index/local.js";
import type { IndexSearchResult } from "./index/local.js";
import { driftStatuses } from "./capture/drift.js";
import { readFailures } from "./capture/failures.js";
import { importDocument } from "./migration/import.js";
import { resolvePreviousId } from "./migration/remap.js";
import { PLACE_CONTEXT_REQUEST } from "./inject/protocol.js";
import type { PlaceContextReply, PlaceContextRequest } from "./inject/protocol.js";

// ---------- Settings helpers ----------
async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as ExtensionSettings;
}

async function saveSettings(partial: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.sync.set(next);
  return next;
}

/**
 * The host a base URL would send captures to, or `null` when the value cannot leave the machine.
 *
 * The loopback test is the transport's own predicate rather than a second copy, so a URL this gate
 * treats as local is a URL the transport will send to locally — the dialog and the refusal can never
 * disagree about which hosts are off-machine. An unparseable URL returns `null` too: a value that is
 * not a URL cannot carry a capture anywhere (G7.2).
 */
function remoteHostOf(raw: string): string | null {
  if (raw.length === 0 || isLoopbackUrl(raw)) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

// ---------- Capture egress ----------
/**
 * Present one local index hit as a search result.
 *
 * The search box is one box for two paths, so a hit arrives as the same shape either way and the
 * surface renders it the same way. What the local path puts in the fields is deliberately literal:
 * `target` is the stored text the match was found in (not a summary of it), and `provider`,
 * `timestamp` and the conversation URL come straight off the stored record. There is no `score`,
 * because a local hit is not more or less *like* the query than the next one — it either contains
 * the tokens or it does not, and the result order is `capturedAt` (G3.9, G5.4).
 */
function toLocalSearchResult(query: string, found: IndexSearchResult): SearchResult {
  return {
    source: "local",
    query,
    count: found.hits.length,
    indexed: found.indexed,
    unmatchedTokens: found.unmatchedTokens,
    results: found.hits.map((hit) => ({
      id: hit.record.recordId,
      actor: hit.record.actor,
      action: "captured",
      target: hit.excerpt,
      timestamp: hit.record.capturedAt,
      provider: hit.record.provider,
      record_type: "Perception",
      source: "cortexbridge",
      metadata: {
        conversationUrl: hit.record.conversationUrl,
        eventId: hit.record.eventId,
      },
    })),
  };
}

/**
 * Send one record and report the outcome honestly.
 *
 * Success is a positive acknowledgement, never a transport status. The failure detail names the
 * endpoint or native host that was tried; `record.target` (the user's text) is never logged.
 */
async function sendRecord(record: MemoryRecord): Promise<SendResult> {
  const settings = await getSettings();
  const result = await createTransport(settings).addMemory(record);

  if (result.acknowledged) {
    await flashBadge("✓", 2000);
    return result;
  }

  console.error(`[HipCortex] capture not acknowledged (${result.reason}): ${result.detail}`);
  await flashBadge("!", 3000);
  return result;
}

async function flashBadge(text: string, ms: number): Promise<void> {
  await chrome.action.setBadgeText({ text });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: "" });
  }, ms);
}

/**
 * A capture reply the surfaces can trust.
 *
 * `success` mirrors the acknowledgement rather than the transport, because a reply that reports
 * `success: true` while the capture was not acknowledged is exactly how an unacknowledged capture
 * gets displayed as delivered.
 */
function toSendResponse(result: SendResult): MessageResponse {
  return result.acknowledged
    ? { success: true, data: result }
    : { success: false, error: result.detail, data: result };
}

/**
 * A reply about a captured conversation.
 *
 * `success` means "the core is now responsible for this capture" — delivered or durably queued. A
 * refusal and a paused queue are both reported as failures, with the pause message naming the
 * unacknowledged count (G2.3).
 */
function toCaptureResponse(outcome: PipelineOutcome): MessageResponse {
  switch (outcome.status) {
    case "rejected":
      return { success: false, error: `capture refused (${outcome.code}): ${outcome.detail}`, data: outcome };
    case "paused":
      return { success: false, error: outcome.message, data: outcome };
    default:
      return { success: true, data: outcome };
  }
}

/**
 * A reply about an import (G4.2).
 *
 * `success` means every record the document carried is now in the core. A refused document and a
 * partially imported one are both reported as failures, with the counts in the message, because
 * `{success: true}` alongside "3 of 8 records imported" is the shape of reply that lets a surface
 * display a migration as complete when it was not — the same mistake the acknowledgement rule
 * forbids on the capture path (G2.9).
 *
 * The report is returned either way in `data`: a caller needs the per-record detail most when the
 * answer is no.
 */
function toImportResponse(report: ImportReport): MessageResponse {
  if (report.failures.length > 0) {
    const first = report.failures[0];
    return { success: false, error: `import refused (${first?.kind}): ${first?.detail}`, data: report };
  }

  const incomplete =
    report.refused + report.outcomes.filter((outcome) => outcome.outcome === "failed").length;
  if (incomplete > 0) {
    return {
      success: false,
      error: `import incomplete: ${report.imported} imported, ${incomplete} not`,
      data: report,
    };
  }

  return { success: true, data: report };
}

// ---------- Queue lifecycle ----------
/**
 * Register the drain wake-ups and attempt one on this worker start (G2.6).
 *
 * The transport is resolved per drain, not captured here: a worker that started while a backlog
 * existed must not keep draining through a transport built from settings the user has since fixed.
 */
const lifecycle = installLifecycle({
  resolve: async () => {
    const settings = await getSettings();
    return { transport: createTransport(settings), actor: settings.defaultActor };
  },
});

void lifecycle.started.catch((error: unknown) => {
  console.error("[HipCortex] capture drain failed", error);
});

// ---------- Context Menus ----------
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
  // Enable side panel on action click (Chrome 116+)
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await getSettings();

  if (info.menuItemId === "hipcortex-add-selection" && info.selectionText) {
    await sendRecord({
      actor: settings.defaultActor,
      action: "selected",
      target: info.selectionText.slice(0, 2000),
      metadata: {
        url: info.pageUrl || tab?.url,
        title: tab?.title,
        source: "context-menu",
      },
    });
    return;
  }

  if (info.menuItemId === "hipcortex-add-page" && tab?.url) {
    await sendRecord({
      actor: settings.defaultActor,
      action: "visited",
      target: tab.title || tab.url,
      metadata: {
        url: tab.url,
        title: tab.title,
        source: "context-menu-page",
      },
    });
    return;
  }

  if (info.menuItemId === "hipcortex-search-selection" && info.selectionText) {
    // Open side panel with query
    if (tab?.windowId && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      // Store pending query for side panel to pick up
      await chrome.storage.session.set({ pendingSearch: info.selectionText });
    }
  }
});

// ---------- Commands ----------
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
        await sendRecord({
          actor: settings.defaultActor,
          action: "selected",
          target: result.trim().slice(0, 2000),
          metadata: { url: tab.url, title: tab.title, source: "keyboard-shortcut" },
        });
      }
    } catch (e) {
      console.error("[HipCortex] quick-add failed", e);
    }
  }
});

// ---------- Message Router (Layer 6 multi-agent style dispatcher) ----------
chrome.runtime.onMessage.addListener(
  (message: MessageType, _sender, sendResponse: (r: MessageResponse) => void) => {
    (async () => {
      try {
        switch (message.type) {
          case "GET_SETTINGS": {
            const settings = await getSettings();
            sendResponse({ success: true, data: settings });
            break;
          }
          case "SAVE_SETTINGS": {
            // A base URL that is not on this machine is the one setting that redirects every future
            // capture, so it persists only against an explicit confirmation naming that exact host.
            // Refusing here (not only in the options page) is what makes "cannot persist without a
            // confirmation" true for every caller, including a future surface (G7.2).
            const host = remoteHostOf(message.settings.apiUrl ?? "");
            if (host !== null && message.confirmRemoteHost !== host) {
              sendResponse({
                success: false,
                error:
                  `refused: saving a base URL that is not on this machine requires a confirmation ` +
                  `naming the host '${host}'; nothing was changed`,
              });
              break;
            }
            const settings = await saveSettings(message.settings);
            sendResponse({ success: true, data: settings });
            break;
          }
          case "HEALTH_CHECK": {
            const settings = await getSettings();
            const transport = createTransport(settings);
            const [health, resolution] = await Promise.all([transport.health(), transport.resolve()]);
            const report: HealthReport = { health, resolution };
            sendResponse({ success: true, data: report });
            break;
          }
          case "ADD_MEMORY": {
            const settings = await getSettings();
            const result = await createTransport(settings).addMemory(message.record);
            sendResponse(toSendResponse(result));
            break;
          }
          case "SEARCH_MEMORY": {
            const limit = message.limit ?? 10;

            // `core` is the explicit request for the runtime's semantic search. Anything else is the
            // local index, which is answered without constructing a transport at all — that is the
            // whole point of that branch of this case: the offline path is a path, not a failure to
            // reach the runtime (G3.9).
            if (message.scope === "core") {
              const settings = await getSettings();
              const result = await createTransport(settings).search(message.query, {
                limit,
                ...(message.provider !== undefined ? { providerFilter: message.provider } : {}),
              });
              sendResponse({ success: true, data: { ...result, source: "core" as const } });
              break;
            }

            const found = await searchIndex({
              text: message.query,
              ...(message.provider !== undefined ? { provider: message.provider } : {}),
              limit,
            });
            sendResponse({ success: true, data: toLocalSearchResult(message.query, found) });
            break;
          }
          case "INDEX_STATUS": {
            const [indexed, providers] = await Promise.all([indexSize(), indexProviders()]);
            const status: SearchIndexStatus = { indexed, providers };
            sendResponse({ success: true, data: status });
            break;
          }
          case "CLEAR_SEARCH_INDEX": {
            const cleared = await clearIndex();
            // Both numbers are reported because the user cleared one store, and the surface has to be
            // able to say which one — the undelivered captures are read here only to be counted, so
            // that "still waiting" is a fact the reply carries rather than a sentence the surface
            // writes from memory (G3.9).
            const [indexed, state] = await Promise.all([indexSize(), readQueue()]);
            const report: SearchIndexReport = {
              cleared,
              indexed,
              unacknowledged: retentionState(state).queued + retentionState(state).retrying + retentionState(state).refused,
            };
            sendResponse({ success: true, data: report });
            break;
          }
          case "QUICK_ADD_SELECTION": {
            const settings = await getSettings();
            const result = await createTransport(settings).addMemory({
              actor: settings.defaultActor,
              action: "selected",
              target: message.text.slice(0, 2000),
              metadata: {
                url: message.url,
                title: message.title,
                source: "popup-or-content",
              },
            });
            sendResponse(toSendResponse(result));
            break;
          }
          case "PLACE_CONTEXT": {
            /**
             * Placing context in another provider's composer (G4.5).
             *
             * The order of these four steps is the guarantee. The setting is read **first**, and a
             * refusal at that point returns before `chrome.tabs.sendMessage` is ever reached — so
             * with injection off, no page in the user's browser receives a message from this code,
             * and the spec that asserts the tab was never spoken to is checking the same fact the
             * DOM diff checks from the other side.
             *
             * The text comes from the local index, which holds only records the core acknowledged
             * (G3.9). Nothing is read back out of the provider page the capture came from: a second
             * read of a drifting DOM to build a message would be a fresh chance to capture the wrong
             * thing, and a record the user can see in search but that has been evicted is refused
             * rather than re-derived.
             */
            const settings = await getSettings();
            if (!settings.injectIntoAiChats) {
              const report: PlaceContextReport = {
                placed: false,
                code: "INJECTION_DISABLED",
                detail: "placing context into AI chats is turned off in the extension options",
              };
              sendResponse({ success: false, data: report, error: report.detail });
              break;
            }

            const records = await readIndex();
            const record = records.find((entry) => entry.recordId === message.indexedId);
            if (record === undefined) {
              const report: PlaceContextReport = {
                placed: false,
                code: "CONTEXT_NOT_FOUND",
                detail: "that capture is no longer held here; capture it again, or search the runtime",
              };
              sendResponse({ success: false, data: report, error: report.detail });
              break;
            }

            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id === undefined) {
              const report: PlaceContextReport = {
                placed: false,
                code: "NO_TARGET_TAB",
                detail: "no active tab to place context into",
              };
              sendResponse({ success: false, data: report, error: report.detail });
              break;
            }

            // Everything after this point is the page's answer, relayed. The worker does not
            // second-guess a refusal from the page and does not retry: the page is the only side
            // that can see whether a composer resolved, and a retry would re-write a node it already
            // reported on.
            try {
              const request: PlaceContextRequest = {
                type: PLACE_CONTEXT_REQUEST,
                text: record.text,
                sourceProvider: record.provider,
              };
              const reply = (await chrome.tabs.sendMessage(tab.id, request)) as
                | PlaceContextReply
                | undefined;

              if (reply === undefined || typeof reply.ok !== "boolean") {
                const report: PlaceContextReport = {
                  placed: false,
                  code: "TAB_UNREACHABLE",
                  detail: "the page did not answer the placement request",
                };
                sendResponse({ success: false, data: report, error: report.detail });
                break;
              }

              sendResponse(
                reply.ok
                  ? { success: true, data: reply.report }
                  : { success: false, data: reply.report, error: reply.report.detail }
              );
            } catch (err) {
              // A tab with no content script — a non-provider page, or one the user has not
              // reloaded since installing — arrives here as a rejection rather than as a reply.
              const detail = err instanceof Error ? err.message : String(err);
              const report: PlaceContextReport = {
                placed: false,
                code: "TAB_UNREACHABLE",
                detail,
              };
              sendResponse({ success: false, data: report, error: detail });
            }
            break;
          }
          case "CAPTURE_UPDATE": {
            const settings = await getSettings();
            const outcome = await runCapturePipeline(
              { providerId: message.providerId, result: message.result, trigger: "passive" },
              {
                transport: createTransport(settings),
                actor: settings.defaultActor,
                autoCapture: settings.autoCapture,
                onDelivered: async () => {
                  await lifecycle.onDelivered();
                },
              }
            );
            sendResponse(toCaptureResponse(outcome));
            break;
          }
          case "CAPTURE_STATUS": {
            const [settings, state, drift, failures] = await Promise.all([
              getSettings(),
              readQueue(),
              driftStatuses(),
              readFailures(),
            ]);
            // One derivation, one read of the queue: every count and the message come from
            // `retentionState`, so the numbers the popup shows cannot disagree with each other.
            const status: CaptureStatus = {
              autoCapture: settings.autoCapture,
              retention: retentionState(state),
              needsAttention: drift.filter((entry) => entry.needsAttention),
              failures: failures.length,
            };
            sendResponse({ success: true, data: status });
            break;
          }

          case "EXPORT_QUEUE": {
            // The actor is resolved the same way the drain resolves it, so a record the user exports
            // and the same record delivered later carry the same `actor` (G4.1).
            const settings = await getSettings();
            sendResponse({ success: true, data: await exportQueue(settings.defaultActor) });
            break;
          }

          case "IMPORT_DOCUMENT": {
            // The document is read, refused or imported here — in the worker, where the transport
            // lives. The surface sent text, so it cannot hand this a record the contract's own
            // reader never accepted, and a page cannot be the side that decides what is written.
            const settings = await getSettings();
            const transport = createTransport(settings);
            const report = await importDocument({
              text: message.text,
              actor: settings.defaultActor,
              now: () => new Date(),
              send: (record) => transport.addMemory(record),
            });
            sendResponse(toImportResponse(report));
            break;
          }

          case "RESOLVE_PREVIOUS_ID": {
            sendResponse({ success: true, data: await resolvePreviousId(message.previousId) });
            break;
          }
          default: {
            // The type is named, not implied: a surface that sent a stale or misspelled message needs
            // to be able to say which one, and "Unknown message type" alone does not (task 8.11).
            const unknown = (message as { type?: unknown }).type;
            sendResponse({ success: false, error: `Unknown message type: ${String(unknown)}` });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ success: false, error: msg });
      }
    })();
    return true; // keep channel open for async
  }
);

console.log("[HipCortex] Background service worker ready");
