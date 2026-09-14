import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../src/types/index.js";
import { SRC_DIR, scanSource, toRepoRelative } from "./helpers/scan.js";

/**
 * Task 1.3 — the node project's boot assertion.
 *
 * It also discharges a question the plan could only answer empirically: `src/**` uses ESM
 * specifiers ending in `.js` (required because `tsc` emits ESM with no bundler), so the harness has
 * to prove that a spec importing `../src/types/index.js` resolves to the TypeScript source rather
 * than failing on a missing JavaScript file.
 */
describe("test harness (node project)", () => {
  it("boots with a real Node process and no DOM", () => {
    expect(typeof process.versions.node).toBe("string");
    expect(typeof globalThis.document).toBe("undefined");
  });

  it("resolves src/ TypeScript through its emitted .js specifiers", () => {
    expect(DEFAULT_SETTINGS.apiUrl).toBe("http://127.0.0.1:3030");
    expect(DEFAULT_SETTINGS.autoCapture).toBe(false);
  });

  it("locates the repository root from a test helper", () => {
    expect(toRepoRelative(SRC_DIR)).toBe("src");
    expect(scanSource().length).toBeGreaterThan(0);
  });
});
