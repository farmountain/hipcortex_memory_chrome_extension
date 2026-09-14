/**
 * The three connection states a user is actually shown — G9.1, G9.2, G9.5.
 *
 * The defect these specs exist for was not a missing feature but a false sentence. The options page
 * had one failure branch, so a user who had installed the extension and nothing else — the normal
 * state, and the only state, for anyone who is not running HipCortex — was told "Check that
 * HipCortex is running". There was nothing to run. The advice had no possible outcome, and the page
 * could not say so because it had never asked the host anything.
 *
 * So this spec boots the **shipped** options document through the **shipped** transport, with the
 * only substitution being the browser's native-messaging layer, and asserts on the text a user
 * reads. A hand-written `HealthReport` would have been shorter and would have proved only that the
 * formatter formats: it could not have noticed the transport reporting a stopped core as healthy,
 * which is the other half of the same bug.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTransport } from "../../src/api/transport/factory.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import type { ExtensionSettings, HealthReport } from "../../src/types/index.js";
import { installChromeMock, installNativeHost } from "../helpers/chrome-mock.js";
import type { ChromeMock, NativeHostOptions } from "../helpers/chrome-mock.js";
import { bootSurface, settle, textOf } from "../helpers/surface.js";

const CORE_URL = "http://127.0.0.1:3030";

/** Consumer Mode, so the probe cannot quietly become an HTTP one and pass for the wrong reason. */
const CONSUMER: ExtensionSettings = { ...DEFAULT_SETTINGS, transportMode: "consumer" };

const HOST_MISSING: NativeHostOptions = {
  lastErrorMessage: "Specified native messaging host not found.",
};
const CORE_UP: NativeHostOptions = {
  reply: { success: true, healthy: true, core_url: CORE_URL },
};
const CORE_DOWN: NativeHostOptions = {
  reply: {
    success: false,
    healthy: false,
    core_url: CORE_URL,
    detail: `core not reachable at ${CORE_URL}: connect ECONNREFUSED`,
  },
};

let mock: ChromeMock;
let report: HealthReport | undefined;

function testConnection(): void {
  const button = document.getElementById("btn-test");
  if (!button) throw new Error("no #btn-test in the mounted surface");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function statusClass(): string {
  const element = document.getElementById("status");
  if (!element) throw new Error("no #status in the mounted surface");
  return element.className;
}

/**
 * Point a mock's browser at a host in a given state and compute the report the worker would return.
 *
 * `src/background.ts` answers `HEALTH_CHECK` with `createTransport(settings).health()` and
 * `.resolve()`; those are the two calls made here, so the report under test is the transport's own
 * output rather than a restatement of it.
 */
async function reportFor(options: NativeHostOptions, using: ChromeMock): Promise<HealthReport> {
  // The mock keeps `lastError` once set, and an installed host must not be reported as missing
  // because an earlier case left a stale message behind.
  using.runtime.lastError = undefined;
  installNativeHost(using, options);

  const transport = createTransport(CONSUMER);
  const [health, resolution] = await Promise.all([transport.health(), transport.resolve()]);
  return { health, resolution };
}

/** The same, against the booted surface's own mock. */
async function arm(options: NativeHostOptions): Promise<void> {
  report = await reportFor(options, mock);
}

afterEach(() => {
  report = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Boot the shipped options page, routed to the report `arm()` last computed. */
async function boot(): Promise<void> {
  mock = await bootSurface("options", {
    GET_SETTINGS: () => ({ success: true, data: CONSUMER }),
    HEALTH_CHECK: () => ({ success: true, data: report }),
  });
}

describe("connection states on the options page", () => {
  it("reports a registered host with a live core as connected", async () => {
    await boot();
    await arm(CORE_UP);

    testConnection();
    await settle();

    expect(textOf("status")).toContain("Connected");
    expect(textOf("status")).toContain(CORE_URL);
    expect(statusClass()).toContain("ok");
  });

  it("reports a browser with no registered host as not installed", async () => {
    await boot();
    await arm(HOST_MISSING);

    testConnection();
    await settle();

    expect(textOf("status")).toContain("Not installed");
    expect(statusClass()).toContain("err");
  });

  it("reports a registered host with a stopped core as installed but not running", async () => {
    await boot();
    await arm(CORE_DOWN);

    testConnection();
    await settle();

    expect(textOf("status")).toContain("Installed but not running");
    expect(textOf("status")).toContain("ECONNREFUSED");
    expect(statusClass()).toContain("err");
  });

  it("never collapses the two failure states into one verdict", async () => {
    await boot();

    await arm(HOST_MISSING);
    testConnection();
    await settle();
    const notInstalled = textOf("status");

    await arm(CORE_DOWN);
    testConnection();
    await settle();
    const notRunning = textOf("status");

    // Distinct, and distinct in the part a user reads first. Two states that differ only deep in a
    // detail string are still one state as far as anyone trying to fix it is concerned (G9.1).
    expect(notInstalled).not.toBe(notRunning);
    expect(notInstalled.startsWith("Not installed")).toBe(true);
    expect(notRunning.startsWith("Installed but not running")).toBe(true);
  });

  it("gives each failure state the action that actually ends it", async () => {
    await boot();

    await arm(HOST_MISSING);
    testConnection();
    await settle();
    const notInstalled = textOf("status");

    await arm(CORE_DOWN);
    testConnection();
    await settle();
    const notRunning = textOf("status");

    // The state with nothing installed names the install; starting a process cannot help here.
    expect(notInstalled).toContain("npm run install:host");
    // The state with a stopped core names starting it, and must not send the user back to install.
    expect(notRunning).toContain("Start HipCortex");
    expect(notRunning).not.toContain("npm run install:host");
    // And neither falls back to the sentence that made this a dead end.
    expect(notInstalled).not.toContain("Check that HipCortex is running");
  });

  it("keeps the three states distinguishable by the text alone, with no class or colour consulted", async () => {
    await boot();
    const verdicts: string[] = [];

    for (const options of [CORE_UP, HOST_MISSING, CORE_DOWN]) {
      await arm(options);
      testConnection();
      await settle();
      verdicts.push(textOf("status").slice(0, 40));
    }

    expect(new Set(verdicts).size).toBe(3);
  });

  it("reaches the same connected state whether the host was present from the start or installed later", async () => {
    await boot();

    // Order A — the host was installed before the extension was ever loaded.
    await arm(CORE_UP);
    testConnection();
    await settle();
    const installedFirst = textOf("status");
    expect(installedFirst).toContain("Connected");

    // Order B — nothing was installed when the extension loaded, and the host appears afterwards.
    await arm(HOST_MISSING);
    testConnection();
    await settle();
    expect(textOf("status")).toContain("Not installed");

    await arm(CORE_UP);
    testConnection();
    await settle();

    // Identical, not merely both successful: nothing about the answer depends on the order in which
    // the two halves were installed (G9.5).
    expect(textOf("status")).toBe(installedFirst);
  });

  it("reports a host removed after the fact as gone, rather than remembering it as connected", async () => {
    await boot();

    await arm(CORE_UP);
    testConnection();
    await settle();
    expect(textOf("status")).toContain("Connected");

    await arm(HOST_MISSING);
    testConnection();
    await settle();

    // The verdict is a function of the current environment, not of the best state ever seen.
    expect(textOf("status")).toContain("Not installed");
  });

  it("keeps the endpoint wording for a transport that cannot tell the two failures apart", async () => {
    await boot();

    // The HTTP path reports no `connection`: it has one failure mode, so it has nothing to
    // distinguish and must not be handed the native advice. Asserting this keeps the native branch
    // from being applied unconditionally later (G9.1).
    report = {
      health: { healthy: false, status: "unreachable" },
      resolution: { mode: "developer", active: "http", fellBack: false, detail: `${CORE_URL}/health` },
    };

    testConnection();
    await settle();

    const status = textOf("status");
    expect(status).toContain("Unreachable");
    expect(status).toContain(`${CORE_URL}/health`);
    expect(status).not.toContain("Installed but not running");
    expect(status).not.toContain("Start HipCortex");
  });
});

const BADGE_TARGET = { popup: "status-badge", sidepanel: "status" } as const;

/**
 * Boot a badge surface for a host in a given state.
 *
 * A badge probes during boot, so the report has to exist before the controller runs. It is computed
 * against a throwaway mock — `bootSurface` installs its own mock for the surface itself — and is
 * plain data by the time the surface reads it.
 */
async function bootBadge(surface: "popup" | "sidepanel", options: NativeHostOptions): Promise<void> {
  report = await reportFor(options, installChromeMock());
  mock = await bootSurface(surface, {
    GET_SETTINGS: () => ({ success: true, data: CONSUMER }),
    HEALTH_CHECK: () => ({ success: true, data: report }),
  });
}

/**
 * The badges are covered on both surfaces because they are two implementations of one indicator. A
 * fix applied to the popup and not the side panel would be invisible to the options-page spec, and
 * a badge that answers "offline" to both failures is the same dead end in a smaller font (G9.1).
 */
describe("connection badges", () => {
  for (const surface of ["popup", "sidepanel"] as const) {
    it(`${surface}: shows online only for a live core`, async () => {
      await bootBadge(surface, CORE_UP);
      expect(textOf(BADGE_TARGET[surface])).toBe("online");
    });

    it(`${surface}: names the not-installed state rather than calling every failure offline`, async () => {
      await bootBadge(surface, HOST_MISSING);
      expect(textOf(BADGE_TARGET[surface])).toBe("host not installed");
    });

    it(`${surface}: distinguishes a stopped core from a missing host`, async () => {
      await bootBadge(surface, CORE_DOWN);
      expect(textOf(BADGE_TARGET[surface])).toBe("core offline");
    });
  }
});
