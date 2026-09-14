/**
 * Provider registration and permission specs (tasks 7.6, 7.7; G1.9, G8.1).
 *
 * Two claims are made about the same set of five providers, and neither is checkable from the code
 * that makes it:
 *
 *   - the manifest grants the extension access to a provider's pages, and the extension must have an
 *     adapter that uses that access. A host granted without an adapter is a permission the user was
 *     asked for and nothing needed; an adapter without a granted host is code that can never run.
 *   - every adapter declares the date its selectors were verified, and that date must not be in the
 *     future — a future date is how an unverified ladder claims freshness it does not have.
 *
 * This spec is therefore the place the manifest and the registry are compared, and it iterates
 * `allAdapters()` rather than a hand-written list so that a sixth adapter cannot be added to the
 * registry without also being reachable and dated.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../helpers/scan.js";
import { isLoopbackUrl } from "../../src/api/transport/endpoints.js";
import { allAdapters, byUrl } from "../../src/capture/providers/registry.js";

const MANIFEST_PATH = path.join(REPO_ROOT, "public", "manifest.json");

interface ContentScriptDeclaration {
  readonly matches?: readonly string[];
}

interface Manifest {
  readonly host_permissions?: readonly string[];
  readonly optional_host_permissions?: readonly string[];
  readonly content_scripts?: readonly ContentScriptDeclaration[];
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
}

/** The hostname of a match pattern such as `https://grok.com/*`. */
function patternHost(pattern: string): string {
  const match = /^[a-z]+:\/\/([^/]+)/.exec(pattern);
  if (!match) return "";

  // An authority may carry userinfo and a port — `http://127.0.0.1:3030/*` is still `127.0.0.1`,
  // and the IPv6 form `http://[::1]:3030/*` is still `[::1]`.
  const authority = match[1].slice(match[1].lastIndexOf("@") + 1).toLowerCase();
  const ipv6 = /^\[[^\]]+\]/.exec(authority);
  if (ipv6) return ipv6[0];

  const port = authority.indexOf(":");
  return port === -1 ? authority : authority.slice(0, port);
}

/**
 * Every provider host, the adapter that claims it, and a conversation URL on that host. This table is
 * what ties the permission to the code: the assertions below fail if either half is added alone.
 */
const PROVIDER_HOSTS: ReadonlyArray<{ host: string; adapter: string; url: string }> = [
  { host: "chatgpt.com", adapter: "chatgpt", url: "https://chatgpt.com/c/redacted-conversation" },
  {
    host: "chat.openai.com",
    adapter: "chatgpt",
    url: "https://chat.openai.com/c/redacted-conversation",
  },
  { host: "claude.ai", adapter: "claude", url: "https://claude.ai/chat/redacted-conversation" },
  {
    host: "gemini.google.com",
    adapter: "gemini",
    url: "https://gemini.google.com/app/redacted-conversation",
  },
  { host: "grok.com", adapter: "grok", url: "https://grok.com/chat/redacted-conversation" },
  {
    host: "chat.deepseek.com",
    adapter: "deepseek",
    url: "https://chat.deepseek.com/a/chat/s/redacted-conversation",
  },
];

describe("provider host permissions — G1.9 (task 7.6)", () => {
  it("describes every registered adapter, so the assertions below cover all of them", () => {
    const described = [...new Set(PROVIDER_HOSTS.map((entry) => entry.adapter))].sort();
    expect(allAdapters().map((adapter) => adapter.id).sort()).toEqual(described);
  });

  it("requests every provider host as an optional permission, never a required one", () => {
    const declared = manifest();
    const required = (declared.host_permissions ?? []).map(patternHost);
    const optional = (declared.optional_host_permissions ?? []).map(patternHost);

    for (const { host } of PROVIDER_HOSTS) {
      // Optional: the user grants it for the sites they actually use.
      expect(optional, host).toContain(host);
      // Required: every install is asked for it whether it is used or not.
      expect(required, host).not.toContain(host);
    }
  });

  it("keeps every required host on the machine that runs the extension", () => {
    const required = manifest().host_permissions ?? [];

    expect(required.length).toBeGreaterThan(0);
    for (const pattern of required) {
      // Capture does not leave the machine unless the user says so, and the only required hosts are
      // the local core. The check is the transport's own predicate rather than a second list, so a
      // host that this spec would wave through is a host the transport would also refuse.
      expect(isLoopbackUrl(pattern.replace(/\/\*$/, "")), pattern).toBe(true);
    }
  });

  it("loads the content script on every provider host — task 7.8", () => {
    const scripts = manifest().content_scripts ?? [];
    const matches = scripts.flatMap((script) => script.matches ?? []);

    expect(matches.length).toBeGreaterThan(0);
    for (const { host } of PROVIDER_HOSTS) {
      expect(matches, host).toContain(`https://${host}/*`);
    }
  });

  it("grants no provider host that no adapter claims", () => {
    const granted = (manifest().optional_host_permissions ?? []).map(patternHost).sort();
    const claimed = PROVIDER_HOSTS.map((entry) => entry.host).sort();

    expect(granted).toEqual(claimed);
  });

  it("resolves a registered adapter for every granted host", () => {
    for (const { adapter, url } of PROVIDER_HOSTS) {
      expect(byUrl(url)?.id, url).toBe(adapter);
    }
  });
});

describe("adapter verification dates — G8.1 (task 7.7)", () => {
  it("declares a real date for every registered adapter", () => {
    const adapters = allAdapters();
    expect(adapters.length).toBeGreaterThan(0);

    for (const adapter of adapters) {
      expect(adapter.verifiedAt, adapter.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const parsed = Date.parse(`${adapter.verifiedAt}T00:00:00.000Z`);
      expect(Number.isNaN(parsed), adapter.id).toBe(false);
      // Round-trip, because `2026-02-31` matches the shape without being a date.
      expect(new Date(parsed).toISOString().slice(0, 10), adapter.id).toBe(adapter.verifiedAt);
    }
  });

  it("does not claim a verification that has not happened yet", () => {
    // Date-only granularity: today is valid, tomorrow is not. The comparison is against the machine
    // clock because the claim is "these selectors were seen on the live page on that day".
    const today = new Date().toISOString().slice(0, 10);

    for (const adapter of allAdapters()) {
      expect(adapter.verifiedAt <= today, `${adapter.id} claims a future verification`).toBe(true);
    }
  });

  it("declares a semver adapter version for every registered adapter", () => {
    for (const adapter of allAdapters()) {
      expect(adapter.adapterVersion, adapter.id).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
