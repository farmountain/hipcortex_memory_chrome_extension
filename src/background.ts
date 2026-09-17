/**
 * HipCortex Chrome Extension — Background Service Worker
 * Layer 7 Harness + Layer 5 Planning: message router, context menus, commands
 */

import type {
  CaptureStatus,
  ConversationCaptureCode,
  ConversationCaptureReport,
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
import { FLUSH_CAPTURE_REQUEST } from "./capture/flush.js";
import type { FlushCaptureReply, FlushCaptureRequest } from "./capture/flush.js";
import { originLabel, queryAllowedOrigins, ungrantedOrigins } from "./ui/site-access.js";

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

/**
 * A reply about a user's own capture request.
 *
 * It always carries the report, including on failure: the surface needs the provider and the message
 * count most when the answer is no, because that is when the user wants to know what *was* seen.
 */
function conversationResponse(report: ConversationCaptureReport, error?: string): MessageResponse {
  return error === undefined
    ? { success: true, data: report }
    : { success: false, data: report, error };
}

/** A capture request that never reached the pipeline, in one shape every branch shares. */
function conversationFailure(
  code: ConversationCaptureCode,
  detail: string,
  known: Pick<ConversationCaptureReport, "providerId" | "url"> = {}
): MessageResponse {
  return conversationResponse({ captured: false, code, detail, ...known }, detail);
}

/**
 * Fold the pipeline's answer into the report, without inventing a second vocabulary for it.
 *
 * `toCaptureResponse` already decides what `success` means for a capture — the core is now
 * responsible for it, delivered or durably queued — so this function relays that same decision and
 * only adds the sentence a person reads. It does not re-derive success from the status here: a second
 * switch would be a second answer to the same question, free to drift from the first.
 *
 * The report's `code` carries the situation, which is what a surface needs to colour the answer
 * correctly. A queued capture is a success by the rule above — it is kept and it will be retried — but
 * it is not in the runtime yet, so it is not "saved", and reporting it as saved is the one thing the
 * acknowledgement rule exists to prevent (G2.9). A surface can therefore render three states without
 * matching prose: no code means stored, `NOT_ACKNOWLEDGED` means kept locally, and `success: false`
 * means the click produced nothing.
 */
function toConversationResponse(
  outcome: PipelineOutcome,
  base: ConversationCaptureReport
): MessageResponse {
  const refusal = toCaptureResponse(outcome);

  switch (outcome.status) {
    case "rejected":
      /**
       * A rejected capture never reached the transport: the pipeline refused the extraction or the
       * normalization. `EXTRACTION_FAILED` is that fact. `NOT_ACKNOWLEDGED` would blame the runtime
       * for a conversation the runtime was never shown.
       */
      return conversationResponse(
        { ...base, code: "EXTRACTION_FAILED" },
        `The conversation could not be read (${outcome.code}): ${outcome.detail}`
      );
    case "paused":
      return conversationResponse({ ...base, code: "NOT_ACKNOWLEDGED" }, refusal.error);
    case "delivered":
      return conversationResponse({ ...base, detail: "Stored." });
    default:
      return conversationResponse({
        ...base,
        code: "NOT_ACKNOWLEDGED",
        detail: "Kept here — the runtime has not acknowledged it yet, so it will be retried.",
      });
  }
}

/**
 * Say why no content script answered, using the manifest as the only list of sites.
 *
 * A throw from `chrome.tabs.sendMessage` means one of two things, and the difference decides whether
 * the user has a next action. The origin is matched against the declared optional hosts rather than
 * against a list held here, so this file needs no provider names at all (G1.8) and cannot fall out of
 * step with `public/manifest.json` the next time a provider is added.
 */
async function explainUnreachable(pageUrl: string, err: unknown): Promise<MessageResponse> {
  const detail = err instanceof Error ? err.message : String(err);
  const declared = [...(chrome.runtime.getManifest().optional_host_permissions ?? [])];

  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    // An unparseable URL is not watched, which is what the check below concludes for an empty origin.
    origin = "";
  }

  /**
   * Compared as whole origins rather than by prefix. A prefix test for `https://example.com` also
   * matches `https://example.com.example.net`, and this function's whole job is to name the right cause
   * — "not a site this extension reads" versus "the site is fine, the grant is missing". The example
   * host stands in for any declared one on purpose: this file holds no provider names at all (G1.8).
   */
  const watched = declared.some((pattern) => {
    const [scheme, rest] = pattern.split("://");
    if (rest === undefined) return false;
    const host = rest.replace(/\/.*$/, "");
    return origin === `${scheme}://${host}`;
  });

  if (!watched) {
    return conversationFailure(
      "PAGE_NOT_WATCHED",
      "This tab is not a conversation on a site this extension reads.",
      { url: pageUrl }
    );
  }

  /**
   * The site *is* watched, so the only remaining cause worth naming is the grant. The granted set is
   * read through the same union the options page uses — `contains` is not enough, because an unpacked
   * install answers `false` for origins it can in fact read.
   */
  const granted = await allowedOrigins(declared);
  const allowed = new Set(granted);
  const allowPattern = declared.find((origin) => {
    const [scheme, rest] = origin.split("://");
    if (rest === undefined) return false;
    const host = rest.replace(/\/.*$/, "");
    return pageUrl.startsWith(`${scheme}://${host}`);
  });

  if (allowPattern !== undefined && !allowed.has(allowPattern)) {
    return conversationFailure(
      "SITE_ACCESS_DENIED",
      `HipCortex is not allowed to read ${originLabel(allowPattern)}. Open the extension options and allow that site, then reload the page.`,
      { url: pageUrl }
    );
  }

  return conversationFailure(
    "PAGE_NOT_WATCHED",
    `That page did not accept the request (${detail}). Reload it and try again.`,
    { url: pageUrl }
  );
}

/**
 * The declared origins the browser is actually letting this build read.
 *
 * Both answers are consulted for the reason `src/ui/site-access.ts` records at length: on an unpacked
 * install `contains` denies origins it in fact grants. The query itself lives there so the worker's
 * verdict and the options page's sentence cannot disagree about the same browser.
 */
async function allowedOrigins(declared: readonly string[]): Promise<string[]> {
  return queryAllowedOrigins(declared);
}

async function flashBadge(text: string, ms: number): Promise<void> {
  const colour = text === "✓" ? "#1a7f37" : "#b45309";
  await chrome.action.setBadgeBackgroundColor({ color: colour });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => {
    // Back to the standing state, not to blank: a flash that cleared the badge would erase the one
    // persistent signal that a site is not allowed yet (G1.11).
    void restoreBadge();
  }, ms);
}

/**
 * The badge, as a standing statement rather than a notification.
 *
 * While a declared site is not allowed the extension can be installed, healthy and completely silent —
 * which is the state the user reported as "it does nothing". The badge is the one part of the UI that
 * is visible without opening anything, so it carries that fact until the grant happens. A permitted
 * build shows no badge at all: a badge that is always present stops being read.
 */
async function restoreBadge(): Promise<void> {
  try {
    const missing = await ungrantedOrigins();
    if (missing.length === 0) {
      await chrome.action.setBadgeText({ text: "" });
      return;
    }
    await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setTitle({
      title: `HipCortex Memory — ${missing.length} of your AI chat sites are not allowed yet. Click to allow them.`,
    });
  } catch {
    // A refused badge write is left alone rather than shown as a problem the user cannot act on.
    // The permission question above cannot fail into a false "all clear": `ungrantedOrigins` resolves
    // an unanswerable query to *not allowed*, deliberately (see `src/ui/site-access.ts`). That is the
    // conservative direction, because the failure being fixed here is a silent healthy-looking install,
    // and a `!` that turns out to be unfounded is a prompt to look at the options page — where the real
    // list is stated in full.
  }
}

/**
 * The options page, opened once, so a new install is told what it needs — G1.11.
 *
 * Opened on `install` only. On `update` the same page would steal a tab from someone who has already
 * made their choice, and a page that appears on every upgrade is read by nobody. The page's own site
 * access section names the hosts and asks for the grant in one click.
 */
function greetFirstRun(details: chrome.runtime.InstalledDetails): void {
  if (details.reason !== "install") return;
  void chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  void restoreBadge();
}

/**
 * Keep the badge true when the site list changes from the options page or from the browser's own
 * extension settings, not only when the worker starts.
 */
function watchSiteAccess(): void {
  chrome.permissions.onAdded.addListener(() => void restoreBadge());
  chrome.permissions.onRemoved.addListener(() => void restoreBadge());
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

chrome.runtime.onInstalled.addListener((details) => {
  setupContextMenus();
  // Enable side panel on action click (Chrome 116+)
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
  greetFirstRun(details);
});

// A worker start is also a state change worth re-reading: Chrome restarts it after an update and
// after eviction, and the site list may have been edited in the browser's own settings meanwhile.
watchSiteAccess();
void restoreBadge();

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

          case "CAPTURE_ACTIVE_TAB": {
            /**
             * The user asked for this conversation, by name (G1.12).
             *
             * This is the only capture path the setting does not gate, and the reason is in what the
             * flag means: `autoCapture` decides whether the extension *acts on its own* when it
             * notices a page change. A click is not the extension acting on its own, so the trigger
             * handed to the pipeline below is `manual` — the pipeline's own rule, not an exception
             * carved out here.
             *
             * Every branch answers with a code and a sentence. There is no path through this case
             * that returns nothing, because a capture button that appears to do nothing is
             * indistinguishable from a broken extension, which is exactly how this gap was reported.
             */
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id === undefined) {
              sendResponse(
                conversationFailure("NO_ACTIVE_TAB", "There is no active tab to capture from.")
              );
              break;
            }

            const pageUrl = tab.url ?? "";
            let reply: FlushCaptureReply | undefined;
            try {
              const request: FlushCaptureRequest = { type: FLUSH_CAPTURE_REQUEST };
              reply = (await chrome.tabs.sendMessage(tab.id, request)) as FlushCaptureReply | undefined;
            } catch (err) {
              /**
               * No content script answered. Two very different situations land here — the page is not
               * a site this extension reads, or it is and the browser has not let the extension run
               * there — and they are told apart by asking the manifest, which is the one list of sites
               * this build claims. `resolveAllowed` is the same union predicate the options page uses,
               * so the page and the worker cannot disagree about whether a site is allowed.
               */
              sendResponse(await explainUnreachable(pageUrl, err));
              break;
            }

            if (reply === undefined || typeof reply.status !== "string") {
              sendResponse(
                conversationFailure(
                  "PAGE_NOT_WATCHED",
                  "That page did not answer. Reload it and try again."
                )
              );
              break;
            }

            if (reply.status === "unsupported") {
              sendResponse(
                conversationFailure(
                  "PAGE_NOT_WATCHED",
                  "That page is not a chat with an AI that this extension can read."
                )
              );
              break;
            }

            if (reply.status === "failed") {
              /**
               * The adapter's own typed refusal, carried through unchanged. This is the branch that
               * makes a broken selector visible: with the passive path the user sees nothing at all,
               * and here they see the slot, the code and the detail that name what changed.
               */
              sendResponse(
                conversationFailure(
                  "EXTRACTION_FAILED",
                  `The conversation could not be read (${reply.code}): ${reply.detail}`,
                  { providerId: reply.providerId, url: reply.url }
                )
              );
              break;
            }

            const settings = await getSettings();
            const outcome = await runCapturePipeline(
              { providerId: reply.providerId, result: reply.result, trigger: "manual" },
              {
                transport: createTransport(settings),
                actor: settings.defaultActor,
                autoCapture: settings.autoCapture,
                onDelivered: async () => {
                  await lifecycle.onDelivered();
                },
              }
            );

            const messages = reply.result.ok ? reply.result.conversation.messages.length : undefined;
            const base: ConversationCaptureReport = {
              captured: toCaptureResponse(outcome).success,
              providerId: reply.providerId,
              url: reply.url,
              messages,
            };
            sendResponse(toConversationResponse(outcome, base));
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
