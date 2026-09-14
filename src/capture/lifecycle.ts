/**
 * Worker lifecycle — the three moments a backlog gets a chance to move.
 *
 * A backlog only drains when something wakes the extension, and an MV3 service worker is terminated
 * between events. There is no timer the queue can hold in memory: this is why the schedule is
 * persisted per entry (`nextAttemptAt`) and why the wake-ups must be registered, not assumed.
 *
 * 1. **Worker start.** The module body runs every time the worker is (re)started, including when
 *    Chrome revives it after eviction, so the drain is kicked here rather than only from
 *    `onInstalled` (G2.6).
 * 2. **`onStartup`, plus the periodic alarm.** `chrome.alarms` is the only timer that survives
 *    eviction; a plain `setTimeout` in a service worker can be cut off mid-flight (G2.6).
 * 3. **After a delivered capture.** A successful send is proof the runtime is reachable, which is
 *    the one moment a retry is most likely to succeed.
 *
 * The alarm is created with the same name every time, so re-registration replaces it instead of
 * leaving a second timer behind.
 */

import { toEgressRecord } from "../schema/index.js";
import type { Transport } from "../api/transport/index.js";
import { drainQueue } from "./queue/queue.js";
import type { DrainOutcome } from "./queue/queue.js";
import { recordAcknowledgedCapture } from "../index/local.js";

export const DRAIN_ALARM_NAME = "hipcortex-capture-drain";

/** One minute is the smallest period `chrome.alarms` honours for a packed extension. */
export const DRAIN_PERIOD_MINUTES = 1;

/**
 * Resolve the transport and actor at drain time.
 *
 * It is a function rather than a value because the transport depends on settings the user can change
 * while a backlog exists — a drain that ran with a `RefusingTransport` captured at worker start would
 * keep refusing after the user fixed the base URL.
 */
export interface DrainContext {
  readonly transport: Transport;
  readonly actor: string;
}

export interface LifecycleDeps {
  readonly resolve: () => Promise<DrainContext>;
  readonly now?: () => Date;
}

export interface Lifecycle {
  /** The drain attempted when this worker started. Awaitable so its result is not guessed at. */
  readonly started: Promise<DrainOutcome>;
  readonly drain: () => Promise<DrainOutcome>;
  /** Same drain; named for the call site after a delivered capture (G2.6). */
  readonly onDelivered: () => Promise<DrainOutcome>;
  readonly dispose: () => void;
}

/** Register (or replace) the periodic drain alarm. Safe to call on every worker start. */
export function ensureDrainAlarm(): void {
  chrome.alarms.create(DRAIN_ALARM_NAME, { periodInMinutes: DRAIN_PERIOD_MINUTES });
}

/**
 * Drain the queue against the transport, stamping each event's egress record for `actor`.
 *
 * The drain is the second place an acknowledgement is observed — the first is the pipeline's direct
 * send — so it is the second place a capture becomes searchable offline. Both call the same index
 * entry point, which is idempotent per `eventId`, so a capture can never be indexed twice (G3.9).
 */
export async function drainNow(deps: LifecycleDeps): Promise<DrainOutcome> {
  const { transport, actor } = await deps.resolve();
  return drainQueue({
    send: (event) => transport.addMemory(toEgressRecord(event, actor)),
    onAcknowledged: async (event, recordId) => {
      await recordAcknowledgedCapture(event, recordId, actor);
    },
    now: deps.now,
  });
}

/**
 * Install the wake-ups and kick the first drain.
 *
 * The returned promise is not awaited here: a worker start must not depend on the network. The
 * caller is expected to observe it (`void lifecycle.started.catch(...)`) so a storage failure is
 * logged rather than becoming an unhandled rejection.
 */
export function installLifecycle(deps: LifecycleDeps): Lifecycle {
  ensureDrainAlarm();

  const drain = (): Promise<DrainOutcome> => drainNow(deps);

  const onStartup = (): void => {
    ensureDrainAlarm();
    void drain();
  };

  const onAlarm = (alarm: chrome.alarms.Alarm): void => {
    if (alarm.name === DRAIN_ALARM_NAME) void drain();
  };

  chrome.runtime.onStartup.addListener(onStartup);
  chrome.alarms.onAlarm.addListener(onAlarm);

  return {
    started: drain(),
    drain,
    onDelivered: drain,
    dispose(): void {
      chrome.runtime.onStartup.removeListener(onStartup);
      chrome.alarms.onAlarm.removeListener(onAlarm);
    },
  };
}
