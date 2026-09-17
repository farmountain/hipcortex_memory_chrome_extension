/**
 * Content-script entry — the only code in this extension that runs on a provider's page.
 *
 * Its whole job is to notice that a conversation changed and hand the change to the worker. It
 * resolves an adapter, extracts, and forwards; it does **not** decide whether to capture, does not
 * keep a queue, and does not touch the network. Those are the worker's business, and the split is
 * what keeps the volatile part (DOM) away from the retention guarantee.
 *
 * Three behaviours are worth naming because each one is a bug avoided:
 *
 * 1. **Unsupported pages select no adapter** and therefore produce no event at all (G1.7). This is
 *    the "fail closed" rule applied to the whole page, not just to a slot: a page this extension has
 *    no adapter for is not something it half-understands.
 * 2. **A settled mutation that changed nothing observable sends nothing.** The signature compared
 *    here is the conversation itself — every message's role, text and attachment count — not the DOM.
 *    Without it, a provider's typing cursor or spinner would emit an event per frame, and every one
 *    of those would count as a capture failure against the adapter's drift counter.
 * 3. **The signature advances only after the worker has the capture.** If handing it over throws,
 *    the page is still the only copy and the next mutation tries again. Advancing early would mark
 *    as delivered something that never left the tab.
 *
 * The debounce is trailing: the timer restarts on every mutation, so a streaming answer is captured
 * when it settles rather than once per token.
 */

import type { MessageResponse, MessageType } from "../types/index.js";
import { byUrl } from "../capture/providers/registry.js";
import type { ExtractResult } from "../capture/providers/types.js";
import { isFlushCaptureRequest } from "../capture/flush.js";
import type { FlushCaptureReply } from "../capture/flush.js";
import { registerContextPlacement } from "../inject/host.js";

/** Trailing debounce for DOM mutations. Long enough to coalesce streaming, short enough to settle. */
export const MUTATION_DEBOUNCE_MS = 750;

export interface ContentDeps {
  readonly url?: () => string;
  readonly title?: () => string;
  readonly doc?: () => Document;
  readonly send?: (message: MessageType) => Promise<MessageResponse>;
  readonly debounceMs?: number;
  readonly now?: () => Date;
  /** `false` disables observation — used by specs that drive `flush()` directly. */
  readonly observe?: boolean;
}

export type ContentOutcome =
  | { readonly status: "unsupported" }
  | { readonly status: "unchanged" }
  | { readonly status: "sent"; readonly providerId: string; readonly extractionOk: boolean }
  | { readonly status: "unsent"; readonly providerId: string; readonly detail: string };

export interface ContentSession {
  /** Extract, compare and (if needed) forward. Awaitable, so a spec asserts facts, not timing. */
  readonly flush: () => Promise<ContentOutcome>;
  /** Arrange a debounced `flush`. Called by the observer and available for manual triggers. */
  readonly schedule: () => void;
  readonly stop: () => void;
  /**
   * Extract once and hand the result back, for a capture the user asked for by name (G1.12).
   *
   * It deliberately does not consult or advance `signature`, and it does not send. Both omissions are
   * the feature: a user who clicks "Capture this conversation" on a page that has not changed since
   * the last observation is asking for this conversation, and the passive path's rule that a settled
   * mutation which changed nothing sends nothing must not turn their click into silence. The worker
   * decides what to do with the result — this returns perception, and perception is all it is.
   */
  readonly capture: () => FlushCaptureReply;
}

/**
 * The conversation itself, as a comparable string.
 *
 * Failures are compared by code and slot: the same unrecognised shape must not be reported on every
 * keystroke, because each report increments the drift counter for that provider.
 */
export function signatureOf(result: ExtractResult): string {
  if (!result.ok) {
    return `!${result.code}|${result.slot ?? ""}|${result.rung ?? "-"}`;
  }
  return result.conversation.messages
    .map((message) => `${message.role}\u0000${message.text}\u0000${message.attachments?.length ?? 0}`)
    .join("\u0001");
}

function defaultSend(message: MessageType): Promise<MessageResponse> {
  return chrome.runtime.sendMessage(message) as Promise<MessageResponse>;
}

export function startContentCapture(deps: ContentDeps = {}): ContentSession {
  const url = deps.url ?? ((): string => location.href);
  const title = deps.title ?? ((): string => document.title);
  const doc = deps.doc ?? ((): Document => document);
  const send = deps.send ?? defaultSend;
  const debounceMs = deps.debounceMs ?? MUTATION_DEBOUNCE_MS;
  const now = deps.now ?? ((): Date => new Date());

  /** The last conversation successfully handed over. `null` means "nothing handed over yet". */
  let signature: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<ContentOutcome> | null = null;
  let stopped = false;

  async function update(): Promise<ContentOutcome> {
    const pageUrl = url();
    const adapter = byUrl(pageUrl);
    if (!adapter) return { status: "unsupported" };

    const pageTitle = title();
    const result = adapter.extract({
      document: doc(),
      url: pageUrl,
      title: pageTitle.length > 0 ? pageTitle : undefined,
      capturedAt: now().toISOString(),
    });

    const next = signatureOf(result);
    if (next === signature) return { status: "unchanged" };

    try {
      await send({ type: "CAPTURE_UPDATE", providerId: adapter.id, url: pageUrl, result });
    } catch (error) {
      return {
        status: "unsent",
        providerId: adapter.id,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    signature = next;
    return { status: "sent", providerId: adapter.id, extractionOk: result.ok };
  }

  /**
   * Coalesce concurrent flushes. A mutation that lands mid-flight schedules another pass, so nothing
   * is lost by sharing the in-flight promise; the alternative is two extractions racing to set one
   * signature.
   */
  const flush = (): Promise<ContentOutcome> => {
    if (pending) return pending;
    pending = update().finally(() => {
      pending = null;
    });
    return pending;
  };

  const schedule = (): void => {
    if (stopped) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  /**
   * Read the page once, for the user's own click (G1.12). Synchronous by design: extraction is the
   * only step here that touches the DOM, and it has to happen while the user's click is still the
   * reason it happened. Awaiting anything first would put a promise between the click and the read
   * for no gain, and the one caller — the message handler below — answers in the same turn either way.
   */
  function capture(): FlushCaptureReply {
    const pageUrl = url();
    const adapter = byUrl(pageUrl);
    if (!adapter) return { status: "unsupported", url: pageUrl };

    const pageTitle = title();
    const result = adapter.extract({
      document: doc(),
      url: pageUrl,
      title: pageTitle.length > 0 ? pageTitle : undefined,
      capturedAt: now().toISOString(),
    });

    if (result.ok) return { status: "captured", providerId: adapter.id, url: pageUrl, result };
    return {
      status: "failed",
      providerId: adapter.id,
      url: pageUrl,
      code: result.code,
      detail: result.detail,
    };
  }

  const observer =
    deps.observe === false
      ? null
      : new MutationObserver(() => {
          schedule();
        });
  observer?.observe(doc().documentElement, { childList: true, subtree: true, characterData: true });

  return {
    flush,
    capture,
    schedule,
    stop(): void {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      observer?.disconnect();
    },
  };
}

/**
 * A content script has a document and a `chrome.runtime` id; a spec importing this module has the
 * first and, at import time, not the second. That difference is what keeps the bundle self-starting
 * without a unit test accidentally starting it.
 */
function isContentScriptContext(): boolean {
  return typeof document !== "undefined" && typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

if (isContentScriptContext()) {
  const session = startContentCapture();
  /**
   * The second thing the page does, from the same gate: answer a placement request (G4.5).
   *
   * It is registered here rather than in a bundle of its own because there is exactly one content
   * script in this extension and a second one would be a second host grant to keep in step. The two
   * are independent after that — the placement listener is the only code below this line that writes
   * to the page, and it writes nothing until the worker asks it to.
   */
  registerContextPlacement();

  /**
   * The third: answer a capture flush (G1.12).
   *
   * It returns `false` for every message that is not a flush, which is what lets the placement
   * listener above and this one coexist — a `false` from every listener means nobody answered, and a
   * message that did match is answered exactly once. It never decides *whether* to capture: the worker
   * asks only after the user clicked, so a request that arrives here is one the user already asked
   * for, and the answer is always a `status` rather than nothing.
   */
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isFlushCaptureRequest(message)) return false;
    sendResponse(session.capture());
    return true;
  });
}
