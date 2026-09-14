/**
 * Worker harness for the router specs (tasks 8.9 – 8.11).
 *
 * The worker is loaded as the **shipped module**, not as a re-implementation: the spec installs the
 * chrome mock, imports `src/background.ts` so its real listeners register, and then drives the
 * router the way Chrome does — a message in, `sendResponse` out, and the boolean return value as the
 * answer to "is this channel still open for an async reply?".
 *
 * `vi.resetModules()` per load is deliberate. The router registers itself on whatever `chrome`
 * global exists at import time, so a second `loadWorker()` in the same file must get a fresh module
 * instance bound to the fresh mock rather than the first one.
 */

import { vi } from "vitest";

import { installChromeMock } from "./chrome-mock.js";
import type { ChromeMock, ChromeMockOptions } from "./chrome-mock.js";
import type { MessageResponse } from "../../src/types/index.js";

export type RouterListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: MessageResponse) => void
) => unknown;

export interface RouterCall {
  readonly response: MessageResponse;
  /** What the listener returned: `true` keeps the channel open for the async reply. */
  readonly returned: unknown;
}

export interface WorkerHarness {
  readonly mock: ChromeMock;
  readonly router: RouterListener;
  readonly send: (message: unknown) => Promise<RouterCall>;
}

/**
 * Import the worker against a fresh mock and hand back its message listener.
 *
 * The listener is taken from the mock's own record of `addListener` calls — the last one registered
 * — rather than by reaching into the module, so a worker that stopped registering a router fails
 * here instead of passing a spec that never really tested the router.
 */
export async function loadWorker(options: ChromeMockOptions = {}): Promise<WorkerHarness> {
  const mock = installChromeMock(options);

  vi.resetModules();
  await import("../../src/background.js");

  const calls = mock.runtime.onMessage.addListener.mock.calls;
  const router = calls[calls.length - 1]?.[0] as RouterListener | undefined;
  if (!router) throw new Error("the worker registered no runtime.onMessage listener");

  const send = async (message: unknown): Promise<RouterCall> => {
    let response: MessageResponse | undefined;
    const returned = router(message, {}, (reply: MessageResponse) => {
      response = reply;
    });

    // The router starts an async task and answers from inside it. Draining microtasks is enough for
    // the storage-backed handlers; one macrotask turn afterwards catches anything scheduled.
    for (let index = 0; index < 200 && response === undefined; index += 1) await Promise.resolve();
    if (response === undefined) await new Promise((resolve) => setTimeout(resolve, 0));
    if (response === undefined) {
      throw new Error(`the router never answered ${String((message as { type?: unknown })?.type)}`);
    }
    return { response, returned };
  };

  return { mock, router, send };
}
