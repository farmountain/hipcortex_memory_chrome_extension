/**
 * Connection-test specs (tasks 8.2 and 8.3).
 *
 * Task 8.2 — the test reports the resolved mode and whether a fallback occurred.
 * Task 8.3 — the failure text names the endpoint or native host that was tried.
 *
 * The reason both matter is the same: a connection test that says only "Unreachable" leaves the
 * user to guess which of two transports was attempted and which URL was probed, and the answer is
 * rarely the one they assume. A third property is asserted here too, because it used to be false:
 * the test must not save anything. A probe that quietly persists whatever is in the form is how an
 * unconfirmed remote host gets written by a button labelled "Test".
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { bootSurface, textOf } from "../helpers/surface.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";
import type { HealthReport } from "../../src/types/index.js";

const LOCAL = "http://127.0.0.1:3030";
const NATIVE_HOST_DETAIL = "native messaging host com.hipcortex.bridge is not available";

function healthy(overrides: Partial<HealthReport["resolution"]> = {}): HealthReport {
  return {
    health: { healthy: true, status: "ok", service: "hipcortex", version: "3.11.0" },
    resolution: {
      mode: "auto",
      active: "http",
      fellBack: true,
      detail: `${LOCAL}/health`,
      ...overrides,
    },
  };
}

function unreachable(overrides: Partial<HealthReport["resolution"]> = {}): HealthReport {
  return {
    health: { healthy: false, status: "unreachable" },
    resolution: {
      mode: "developer",
      active: "http",
      fellBack: false,
      detail: `${LOCAL}/health`,
      ...overrides,
    },
  };
}

function sentTypes(mock: ChromeMock): string[] {
  return mock.runtime.sendMessage.mock.calls.map((call) => String((call[0] as { type?: unknown })?.type));
}

async function runTest(
  report: HealthReport | undefined,
  options: { readonly error?: string; readonly apiUrl?: string; readonly fieldValue?: string } = {}
): Promise<ChromeMock> {
  const mock = await bootSurface("options", {
    GET_SETTINGS: () => ({ success: true, data: { ...DEFAULT_SETTINGS, apiUrl: options.apiUrl ?? LOCAL } }),
    HEALTH_CHECK: () => ({ success: report !== undefined, data: report, error: options.error }),
  });
  if (options.fieldValue !== undefined) {
    (document.getElementById("apiUrl") as HTMLInputElement).value = options.fieldValue;
  }
  document.getElementById("btn-test")?.dispatchEvent(new Event("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return mock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the connection test reports the resolved mode and the fallback — G7.3 (task 8.2)", () => {
  it("names the mode and says a fallback occurred", async () => {
    await runTest(healthy());

    const status = textOf("status");
    expect(status).toContain("auto");
    expect(status).toContain("fell back");
    expect(status).toContain(`${LOCAL}/health`);
    expect(status).toContain("hipcortex");
  });

  it("says when no fallback occurred, rather than staying silent about it", async () => {
    await runTest(healthy({ mode: "developer", active: "http", fellBack: false }));

    const status = textOf("status");
    expect(status).toContain("no fallback");
    expect(status).toContain("developer");
  });
});

describe("the connection test names what was tried — task 8.3", () => {
  it("names the HTTP endpoint on failure", async () => {
    await runTest(unreachable(), { error: "fetch failed" });

    const status = textOf("status");
    expect(status).toContain("Unreachable");
    expect(status).toContain(`${LOCAL}/health`);
    expect(status).toContain("developer");
    expect(status).toContain("fetch failed");
  });

  it("names the native host when that is what was tried", async () => {
    await runTest(
      {
        health: { healthy: false, status: "unreachable" },
        resolution: { mode: "consumer", active: "native", fellBack: false, detail: NATIVE_HOST_DETAIL },
      },
      { error: "the desktop app did not answer" }
    );

    expect(textOf("status")).toContain(NATIVE_HOST_DETAIL);
  });

  it("refuses to probe an unparseable URL instead of guessing", async () => {
    const mock = await runTest(healthy(), { fieldValue: "not a url" });

    expect(textOf("status")).toContain("Enter a valid base URL");
    expect(sentTypes(mock)).not.toContain("HEALTH_CHECK");
  });
});

describe("probing never persists anything", () => {
  it("sends no save, and says which URL it tested when the field holds an unsaved edit", async () => {
    const mock = await runTest(healthy(), { fieldValue: "http://127.0.0.1:9999" });

    expect(sentTypes(mock)).not.toContain("SAVE_SETTINGS");
    const status = textOf("status");
    expect(status).toContain(`testing the saved URL ${LOCAL}`);
    expect(status).toContain("http://127.0.0.1:9999");
  });
});
