/**
 * Egress-banner specs (task 8.5) — G7.4.
 *
 * G7.4: "a persistent banner in popup and side panel names the host while non-loopback egress is
 * configured."
 *
 * "Persistent" is the load-bearing word, so the assertions are about presence in the *shipped*
 * markup of both surfaces rather than about a toast that could fade — the banner is mounted with the
 * document, and its text is asserted to name the host rather than merely to appear. The loopback
 * case asserts absence, because a banner that shows while captures stay on this machine trains the
 * user to ignore the one time it matters.
 */

import { describe, expect, it } from "vitest";

import { bootSurface, textOf, isHidden } from "../helpers/surface.js";
import type { SurfaceName } from "../helpers/surface.js";

const LOCAL = "http://127.0.0.1:3030";
const REMOTE = "https://memory.example.com:8443/v1";
const REMOTE_HOST = "memory.example.com";

/** Boot a surface with the saved base URL and no other interest, and return the mock. */
function bootWithApiUrl(name: SurfaceName, apiUrl: string) {
  return bootSurface(name, {
    GET_SETTINGS: () => ({ success: true, data: { apiUrl } }),
    HEALTH_CHECK: () => ({
      success: true,
      data: {
        health: { healthy: true, status: "ok" },
        resolution: { mode: "auto", active: "http", fellBack: false, detail: `${apiUrl}/health` },
      },
    }),
    CAPTURE_STATUS: () => ({
      success: true,
      data: {
        autoCapture: false,
        retention: { queued: 0, retrying: 0, refused: 0, paused: false, refusals: [], message: null },
        needsAttention: [],
        failures: 0,
      },
    }),
  });
}

describe.each<SurfaceName>(["popup", "sidepanel"])("%s egress banner — G7.4 (task 8.5)", (name) => {
  it("shows and names the host when the base URL is not on this machine", async () => {
    await bootWithApiUrl(name, REMOTE);

    expect(isHidden("egress-banner")).toBe(false);
    const text = textOf("egress-banner");
    expect(text).toContain(REMOTE_HOST);
    expect(text).toMatch(/not to HipCortex on this computer/);
  });

  it("stays absent for a loopback base URL", async () => {
    await bootWithApiUrl(name, LOCAL);

    expect(isHidden("egress-banner")).toBe(true);
    expect(textOf("egress-banner")).toBe("");
  });

  it("is announced to assistive technology rather than only painted", async () => {
    await bootWithApiUrl(name, REMOTE);

    expect(document.getElementById("egress-banner")?.getAttribute("role")).toBe("status");
  });
});
