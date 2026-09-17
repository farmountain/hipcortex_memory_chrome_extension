/**
 * Site access on the options page — G1.10, G1.13.
 *
 * The page has one job here that no other surface can do: `chrome.permissions.request` answers only to
 * a gesture in the page that asks for it, and a gesture does not survive a message hop. Routing the
 * grant through the worker would therefore turn one click into a silent no-op — the request resolves
 * `false` with nothing shown to the user — which is the shape of failure this whole change set exists
 * to remove. So the spec pins the request as a direct call from the page.
 *
 * Three further properties are asserted because they are the ones a plausible implementation gets
 * wrong:
 *
 * 1. the page's sentence is built from the same resolution the worker's badge uses, so the two cannot
 *    disagree about the same install;
 * 2. the boolean `permissions.request` returns is not treated as the verdict — the state is re-read,
 *    because a grant that the browser reports as declined can still have taken effect;
 * 3. the control stays usable once everything is allowed, because a complete list can still be revoked
 *    from the browser's own extension settings, and a disabled button would leave the user with no way
 *    to re-grant it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { bootSurface, textOf } from "../helpers/surface.js";
import { shippedManifest } from "../helpers/chrome-mock.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import { DEFAULT_SETTINGS } from "../../src/types/index.js";

const DECLARED = shippedManifest().optional_host_permissions ?? [];

function optionsReplies() {
  return {
    GET_SETTINGS: () => ({ success: true, data: { ...DEFAULT_SETTINGS } }),
  };
}

/** Boot the page with a specific permission state and hand back the mock. */
async function boot(permissions: {
  contains?: (origins: readonly string[]) => boolean;
  request?: (origins: readonly string[]) => Promise<boolean>;
  granted?: readonly string[];
}): Promise<ChromeMock> {
  return bootSurface("options", optionsReplies(), { permissions });
}

describe("the options page states which sites are allowed — G1.10", () => {
  it("names every declared host and says nothing is captured while none is allowed", async () => {
    await boot({ contains: () => false, granted: [] });

    const state = textOf("site-access-state");
    // The hosts come from the shipped manifest, so this assertion is about the build's own list.
    expect(state).toContain("chatgpt.com");
    expect(state).toContain("claude.ai");
    expect(state).toMatch(/nothing is captured/i);
    expect(document.getElementById("site-access-state")!.classList.contains("err")).toBe(true);
  });

  it("reports full coverage as good news rather than staying silent", async () => {
    await boot({ contains: () => false, granted: [...DECLARED] });

    const state = textOf("site-access-state");
    // The sentence counts the hosts it is talking about, so a user can see the list it was measured
    // against rather than taking a bare "Active" on trust.
    expect(state).toMatch(/all \d+ AI chat sites/i);
    expect(document.getElementById("site-access-state")!.classList.contains("ok")).toBe(true);
  });

  it("does not describe an unpacked install as denied", async () => {
    /**
     * The measured trap: on an unpacked build `contains` answers `false` for every declared origin
     * while `getAll` lists them all. A page driven by `contains` alone would tell a user to allow sites
     * that are already allowed, and the badge and the page would contradict each other.
     */
    await boot({ contains: () => false, granted: [...DECLARED] });
    expect(document.getElementById("site-access-state")!.classList.contains("ok")).toBe(true);
  });
});

describe("the grant is requested from the page, in one gesture — G1.10", () => {
  it("asks the browser for the whole declared list at once", async () => {
    const mock = await boot({ contains: () => false, request: async () => true, granted: [] });

    document.getElementById("btn-grant-sites")!.dispatchEvent(new Event("click", { bubbles: true }));
    for (let index = 0; index < 60; index += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mock.permissions.request).toHaveBeenCalledTimes(1);
    // One prompt, not six: a page that asked per host would train the user to accept.
    expect(mock.permissions.request.mock.calls[0]?.[0]).toEqual({ origins: [...DECLARED] });
  });

  it("never routes the request through the worker", async () => {
    const mock = await boot({ contains: () => false, request: async () => true, granted: [] });
    mock.runtime.sendMessage.mockClear();

    document.getElementById("btn-grant-sites")!.dispatchEvent(new Event("click", { bubbles: true }));
    for (let index = 0; index < 60; index += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const types = mock.runtime.sendMessage.mock.calls.map(
      (call) => (call[0] as Record<string, unknown>)["type"]
    );
    // The gesture would not survive the hop, so a permission request sent as a message can only fail.
    expect(types).not.toContain("REQUEST_SITE_ACCESS");
    expect(mock.permissions.request).toHaveBeenCalled();
  });

  it("re-reads the state instead of trusting the boolean the browser returned", async () => {
    /**
     * `chrome.permissions.request` can resolve `false` on a grant that in fact took effect. Trusting the
     * boolean would leave the page claiming nothing is allowed, and the badge agreeing with it, on an
     * install that can now read every site.
     */
    const mock = await boot({ contains: () => false, request: async () => false, granted: [] });
    expect(document.getElementById("site-access-state")!.classList.contains("err")).toBe(true);

    mock.permissions.contains = vi.fn(() => true) as unknown as ChromeMock["permissions"]["contains"];
    mock.permissions.getAll = vi.fn(async () => ({ origins: [...DECLARED] })) as unknown as ChromeMock["permissions"]["getAll"];

    document.getElementById("btn-grant-sites")!.dispatchEvent(new Event("click", { bubbles: true }));
    for (let index = 0; index < 60; index += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById("site-access-state")!.classList.contains("ok")).toBe(true);
  });

  it("says the browser declined rather than leaving the click unexplained", async () => {
    await boot({ contains: () => false, request: async () => false, granted: [] });

    document.getElementById("btn-grant-sites")!.dispatchEvent(new Event("click", { bubbles: true }));
    for (let index = 0; index < 60; index += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(textOf("status")).toMatch(/declined/i);
  });

  it("keeps the control available once everything is allowed", async () => {
    await boot({ contains: () => false, granted: [...DECLARED] });

    const button = document.getElementById("btn-grant-sites") as HTMLButtonElement;
    // A list can still be revoked from the browser's own settings, and this page is where it is put
    // back. Disabling the button on success would remove the only route to that.
    expect(button.disabled).toBe(false);
  });
});

describe("the capture switch is described by its outcome — G1.13", () => {
  it("labels the switch as capturing conversations, not as a mechanism", async () => {
    await boot({ contains: () => false, granted: [] });

    const label = document.querySelector('label[for="autoCapture"]');
    expect(label).not.toBeNull();
    const text = label!.textContent ?? "";
    // The original wording named a setting. A user reading it could not tell it was the switch that
    // decides whether anything at all is captured.
    expect(text.toLowerCase()).toContain("capture");
    expect(text.toLowerCase()).toMatch(/conversation/);
    expect(text.toLowerCase()).not.toBe("auto capture");
  });

  it("points at the site list as the thing that actually limits capture", async () => {
    await boot({ contains: () => false, granted: [] });

    // The hint beside the switch has to say that allowing a site is a separate act; otherwise a user
    // reads "on by default" and concludes their conversations are being read from sites they refused.
    const page = document.body.textContent ?? "";
    expect(page).toMatch(/nothing is captured from a site/i);
  });

  it("says the site-access section exists and what it is for", async () => {
    await boot({ contains: () => false, granted: [] });

    expect(document.getElementById("site-access")).not.toBeNull();
    const section = document.getElementById("site-access")!.textContent ?? "";
    expect(section).toMatch(/read a conversation/i);
    // The badge is described here so the `!` a user sees in the toolbar has an explanation somewhere.
    expect(section).toMatch(/!/);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
