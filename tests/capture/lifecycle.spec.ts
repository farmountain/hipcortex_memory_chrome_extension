/**
 * Lifecycle specs (task 6.11, G2.6).
 *
 * Three wake-ups exist and each one has to be provable: worker start, `onStartup` (plus the periodic
 * alarm), and after a delivered capture. The second claim here is subtler — a *restart* must resume
 * the persisted schedule rather than restart it, because an MV3 worker is evicted constantly and a
 * schedule that resets on every wake is not a schedule.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { installChromeMock } from "../helpers/chrome-mock.js";
import type { ChromeMock, EventMock } from "../helpers/chrome-mock.js";
import { acknowledged, createTransportStub, refused } from "../helpers/transport-stub.js";
import { makeCaptureEvent } from "../helpers/events.js";
import {
  DRAIN_ALARM_NAME,
  DRAIN_PERIOD_MINUTES,
  drainNow,
  ensureDrainAlarm,
  installLifecycle,
} from "../../src/capture/lifecycle.js";
import { enqueueEvent, readQueue } from "../../src/capture/queue/queue.js";
import type { Lifecycle } from "../../src/capture/lifecycle.js";

const NOW = new Date("2025-01-15T00:00:00.000Z");
const ACTOR = "spec-actor";

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

/** The first listener registered on a mocked event, as a callable. */
function listenerOf(event: EventMock): (...args: unknown[]) => unknown {
  const call = event.addListener.mock.calls[0];
  if (!call) throw new Error("no listener was registered");
  return call[0] as (...args: unknown[]) => unknown;
}

function alarm(name: string): chrome.alarms.Alarm {
  return { name } as chrome.alarms.Alarm;
}

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

describe("the periodic alarm", () => {
  it("is created with the drain name and the smallest honoured period", () => {
    ensureDrainAlarm();

    expect(mock.alarms.create).toHaveBeenCalledTimes(1);
    expect(mock.alarms.create).toHaveBeenCalledWith(DRAIN_ALARM_NAME, {
      periodInMinutes: DRAIN_PERIOD_MINUTES,
    });
    expect(DRAIN_PERIOD_MINUTES).toBe(1);
  });

  it("reuses one name so re-registering replaces the timer instead of adding one", () => {
    ensureDrainAlarm();
    ensureDrainAlarm();

    const names = mock.alarms.create.mock.calls.map((call) => call[0]);
    expect(names).toEqual([DRAIN_ALARM_NAME, DRAIN_ALARM_NAME]);
  });
});

describe("a drain on worker start (G2.6)", () => {
  it("delivers a due entry with the actor resolved at drain time", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1", text: "waiting" }), NOW);
    const stub = createTransportStub(acknowledged("rec-1"));

    const lifecycle = installLifecycle({
      resolve: async () => ({ transport: stub.transport, actor: ACTOR }),
      now: () => at(10_000),
    });

    const outcome = await lifecycle.started;

    expect(outcome.delivered).toBe(1);
    expect(outcome.unacknowledged).toBe(0);
    expect(stub.records[0]?.actor).toBe(ACTOR);
    expect(await readQueue()).toEqual({ entries: [], paused: false });
    lifecycle.dispose();
  });

  it("leaves an entry that is not yet due untouched", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), NOW);
    const stub = createTransportStub(acknowledged("rec-1"));

    const lifecycle = installLifecycle({
      resolve: async () => ({ transport: stub.transport, actor: ACTOR }),
      now: () => NOW,
    });

    const outcome = await lifecycle.started;

    expect(outcome.attempted).toBe(0);
    expect(stub.calls).toBe(0);
    expect((await readQueue()).entries).toHaveLength(1);
    lifecycle.dispose();
  });

  it("resolves the transport on every drain, so a fixed base URL is picked up", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), NOW);
    const stub = createTransportStub(refused("UNREACHABLE"));
    let clock = at(10_000);
    let resolutions = 0;

    const lifecycle = installLifecycle({
      resolve: async () => {
        resolutions += 1;
        return { transport: stub.transport, actor: ACTOR };
      },
      now: () => clock,
    });

    await lifecycle.started;
    expect(resolutions).toBe(1);

    // The runtime comes back; the next wake-up uses settings resolved then, not values captured at
    // worker start (the `RefusingTransport` failure mode). The clock has to move too: the first
    // refusal pushed the entry's `nextAttemptAt` four seconds out.
    stub.setReply(acknowledged("rec-1"));
    clock = at(20_000);
    const second = await lifecycle.drain();

    expect(resolutions).toBe(2);
    expect(second.delivered).toBe(1);
    expect(await readQueue()).toEqual({ entries: [], paused: false });
    lifecycle.dispose();
  });

  it("keeps the persisted schedule across a simulated worker restart", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), NOW);

    const failing = createTransportStub(refused("UNREACHABLE"));
    const first: Lifecycle = installLifecycle({
      resolve: async () => ({ transport: failing.transport, actor: ACTOR }),
      now: () => at(10_000),
    });
    await first.started;
    first.dispose();

    const afterFirst = (await readQueue()).entries[0];
    expect(afterFirst?.attempts).toBe(1);
    expect(afterFirst?.nextAttemptAt).toBe(at(14_000).toISOString());

    // Restart two seconds later: the entry is not due yet, and the worker must not hammer it.
    const early = createTransportStub(acknowledged("rec-early"));
    const restarted: Lifecycle = installLifecycle({
      resolve: async () => ({ transport: early.transport, actor: ACTOR }),
      now: () => at(12_000),
    });
    const earlyOutcome = await restarted.started;
    restarted.dispose();

    expect(earlyOutcome.attempted).toBe(0);
    expect(early.calls).toBe(0);
    const stillWaiting = (await readQueue()).entries[0];
    expect(stillWaiting?.attempts).toBe(1);
    expect(stillWaiting?.nextAttemptAt).toBe(at(14_000).toISOString());

    // Restart once the backoff has elapsed: the entry is due and the schedule carried over.
    const late = createTransportStub(acknowledged("rec-late"));
    const third: Lifecycle = installLifecycle({
      resolve: async () => ({ transport: late.transport, actor: ACTOR }),
      now: () => at(14_000),
    });
    const lateOutcome = await third.started;
    third.dispose();

    expect(lateOutcome.delivered).toBe(1);
    expect(await readQueue()).toEqual({ entries: [], paused: false });
  });
});

describe("the other two wake-ups", () => {
  it("drains from onStartup and re-registers the alarm", async () => {
    const stub = createTransportStub(acknowledged("rec-1"));
    const lifecycle = installLifecycle({
      resolve: async () => ({ transport: stub.transport, actor: ACTOR }),
      now: () => at(10_000),
    });
    mock.alarms.create.mockClear();

    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), NOW);
    listenerOf(mock.runtime.onStartup)(undefined);

    await vi.waitFor(() => expect(stub.calls).toBe(1));
    expect(mock.alarms.create).toHaveBeenCalledWith(DRAIN_ALARM_NAME, {
      periodInMinutes: DRAIN_PERIOD_MINUTES,
    });
    lifecycle.dispose();
  });

  it("drains from the alarm, but only for its own alarm name", async () => {
    const stub = createTransportStub(acknowledged("rec-1"));
    const lifecycle = installLifecycle({
      resolve: async () => ({ transport: stub.transport, actor: ACTOR }),
      now: () => at(10_000),
    });
    const onAlarm = listenerOf(mock.alarms.onAlarm);

    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), NOW);
    onAlarm(alarm("some-other-alarm"));
    await Promise.resolve();
    expect(stub.calls).toBe(0);

    onAlarm(alarm(DRAIN_ALARM_NAME));
    await vi.waitFor(() => expect(stub.calls).toBe(1));
    expect(await readQueue()).toEqual({ entries: [], paused: false });
    lifecycle.dispose();
  });

  it("drains when a capture has just been delivered", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), NOW);
    const stub = createTransportStub(acknowledged("rec-1"));

    const lifecycle = installLifecycle({
      resolve: async () => ({ transport: stub.transport, actor: ACTOR }),
      now: () => at(10_000),
    });
    await lifecycle.started;

    await enqueueEvent(makeCaptureEvent({ eventId: "evt-2" }), NOW);
    const outcome = await lifecycle.onDelivered();

    expect(outcome.delivered).toBe(1);
    expect(stub.records).toHaveLength(2);
    lifecycle.dispose();
  });

  it("removes exactly the listeners it added", () => {
    const lifecycle = installLifecycle({
      resolve: async () => ({ transport: createTransportStub().transport, actor: ACTOR }),
    });

    const startup = mock.runtime.onStartup.addListener.mock.calls[0]?.[0];
    const alarmListener = mock.alarms.onAlarm.addListener.mock.calls[0]?.[0];
    lifecycle.dispose();

    expect(mock.runtime.onStartup.removeListener).toHaveBeenCalledWith(startup);
    expect(mock.alarms.onAlarm.removeListener).toHaveBeenCalledWith(alarmListener);
  });
});

describe("drainNow", () => {
  it("stamps the resolved actor on every record it sends", async () => {
    await enqueueEvent(makeCaptureEvent({ eventId: "evt-1" }), NOW);
    const stub = createTransportStub(acknowledged("rec-1"));

    await drainNow({ resolve: async () => ({ transport: stub.transport, actor: "someone-else" }), now: () => at(10_000) });

    expect(stub.records[0]?.actor).toBe("someone-else");
  });
});
