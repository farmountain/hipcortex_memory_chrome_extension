/**
 * Provider registry specs (task 5.12).
 *
 * The registry is the single registration point, and these specs defend the two properties that
 * make it safe: an adapter cannot reach another adapter (so a provider's DOM knowledge stays in its
 * own module), and no URL is claimed by two adapters (so `byUrl` returning the first match is not a
 * coin flip that changes with iteration order).
 */

import { describe, expect, it } from "vitest";

import { scanTree } from "../../helpers/scan.js";
import { chatgptAdapter, CHATGPT_HOSTS } from "../../../src/capture/providers/chatgpt.js";
import { allAdapters, byId, byUrl } from "../../../src/capture/providers/registry.js";

const PROVIDERS_DIR = "src/capture/providers";

/** Files that are not adapters: the shared contract and the registration point itself. */
const NON_ADAPTER_FILES = ["registry.ts", "types.ts"];

/**
 * One URL per adapter that it is expected to claim. A new adapter must be added here — the spec
 * below fails on the mismatch rather than silently skipping the provider it knows nothing about.
 */
const SAMPLE_URLS: Readonly<Record<string, readonly string[]>> = {
  chatgpt: ["https://chatgpt.com/c/redacted-conversation", "https://chat.openai.com/c/redacted-conversation"],
  claude: ["https://claude.ai/chat/redacted-conversation"],
  gemini: ["https://gemini.google.com/app/redacted-conversation"],
  grok: ["https://grok.com/chat/redacted-conversation"],
  deepseek: ["https://chat.deepseek.com/a/chat/s/redacted-conversation"],
};

function providerFiles() {
  return scanTree(PROVIDERS_DIR).filter(
    (file) => !NON_ADAPTER_FILES.includes(file.path.slice(file.path.lastIndexOf("/") + 1))
  );
}

function importSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const pattern = /\bfrom\s+"([^"]+)"/g;
  let match = pattern.exec(content);
  while (match !== null) {
    specifiers.push(match[1]);
    match = pattern.exec(content);
  }
  return specifiers;
}

describe("adapter isolation — G1.1", () => {
  it("keeps every adapter import to the shared contract and the extraction helper", () => {
    const adapters = providerFiles();
    expect(adapters.length).toBeGreaterThan(0);

    for (const adapter of adapters) {
      for (const specifier of importSpecifiers(adapter.content)) {
        if (!specifier.startsWith("./")) continue;
        // A sibling import under this directory may only be the shared contract. Importing another
        // adapter would let one provider's selectors leak into another's, and the drift that
        // follows would be attributed to the wrong provider.
        expect(specifier, `${adapter.path} imports ${specifier}`).toBe("./types.js");
      }
    }
  });

  it("names every adapter module after the id it declares", () => {
    for (const adapter of allAdapters()) {
      const file = providerFiles().find((candidate) =>
        candidate.path.endsWith(`/${adapter.id}.ts`)
      );
      expect(file, `no module named ${adapter.id}.ts`).toBeDefined();
    }
  });

  it("registers every adapter module from the registry", () => {
    const registry = scanTree(PROVIDERS_DIR).find((file) => file.path.endsWith("/registry.ts"));
    expect(registry).toBeDefined();

    for (const adapter of providerFiles()) {
      const name = adapter.path.slice(adapter.path.lastIndexOf("/") + 1).replace(/\.ts$/, "");
      // An adapter that no import reaches is dead code pretending to be coverage.
      expect(registry?.content, `${name}.ts is not imported by registry.ts`).toContain(`./${name}.js`);
    }
  });

  it("declares distinct ids and display names", () => {
    const adapters = allAdapters();
    expect(adapters.length).toBeGreaterThan(0);
    expect(new Set(adapters.map((adapter) => adapter.id)).size).toBe(adapters.length);
    expect(new Set(adapters.map((adapter) => adapter.displayName)).size).toBe(adapters.length);
  });
});

describe("registry lookup", () => {
  it("resolves an adapter by id", () => {
    expect(byId("chatgpt")).toBe(chatgptAdapter);
    expect(byId("not-a-provider")).toBeNull();
  });

  it("resolves an adapter by URL and nothing for an unsupported URL", () => {
    for (const url of SAMPLE_URLS.chatgpt) {
      expect(byUrl(url), url).toBe(chatgptAdapter);
    }
    expect(byUrl("https://example.com/chat")).toBeNull();
    expect(byUrl("https://chatgpt.com/")).toBeNull();
  });

  it("returns exactly one adapter for every URL any adapter claims", () => {
    const claimed: string[] = [];
    for (const adapter of allAdapters()) {
      for (const url of SAMPLE_URLS[adapter.id] ?? []) {
        expect(adapter.matches(url), `${adapter.id} does not match its own sample ${url}`).toBe(true);
        claimed.push(url);
      }
    }

    for (const url of claimed) {
      const matches = allAdapters().filter((adapter) => adapter.matches(url));
      expect(matches.map((adapter) => adapter.id), url).toHaveLength(1);
      expect(byUrl(url)).toBe(matches[0]);
    }
  });

  it("has sample URLs for every registered adapter", () => {
    // The check above is only as complete as this list, so a missing entry is a failure rather than
    // a silently narrower test.
    expect(Object.keys(SAMPLE_URLS).sort()).toEqual(allAdapters().map((adapter) => adapter.id).sort());
  });

  it("does not claim a provider subdomain as a different provider's host", () => {
    for (const host of CHATGPT_HOSTS) {
      expect(byUrl(`https://${host}/c/redacted-conversation`)).toBe(chatgptAdapter);
    }
  });
});
