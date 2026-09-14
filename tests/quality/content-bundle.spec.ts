/**
 * Content-bundle specs (tasks 6.16, 6.17, G6.4).
 *
 * The content script is the one file in this extension that is *bundled*: `tsc` emits ESM into
 * `dist/` for everything else, but a content script has no `<script type="module">` context, so
 * `scripts/build-content.js` bundles `src/content/entry.ts` into a single classic IIFE.
 *
 * This spec runs the bundler itself instead of reading whatever `dist/content.js` happens to be on
 * disk. A test that reads a build artifact can pass against a stale artifact — which is exactly the
 * failure this repository already documents about the committed `dist/`. Running the bundler costs
 * about a tenth of a second and makes the assertion true of the source, not of a leftover file.
 *
 * The negative assertions below are the point of the perception boundary restated for the bundle:
 * the code that runs inside a provider's page must not contain a network call, a native-messaging
 * port, or a storage access, and the only way to be sure is to look at what was actually shipped.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { REPO_ROOT } from "../helpers/scan.js";

const BUNDLE_PATH = path.join(REPO_ROOT, "dist", "content.js");
const MANIFEST_PATH = path.join(REPO_ROOT, "public", "manifest.json");
const ENTRY_SOURCE = path.join(REPO_ROOT, "src", "content", "entry.ts");

interface ContentScriptDeclaration {
  readonly matches?: readonly string[];
  readonly js?: readonly string[];
  readonly run_at?: string;
}

interface Manifest {
  readonly content_scripts?: readonly ContentScriptDeclaration[];
}

let bundle: string;

beforeAll(() => {
  execFileSync(process.execPath, ["scripts/build-content.js"], { cwd: REPO_ROOT, stdio: "pipe" });
  bundle = readFileSync(BUNDLE_PATH, "utf8");
}, 60_000);

describe("the bundle the content script is loaded from (G6.4)", () => {
  it("is written by the bundler into dist/", () => {
    expect(existsSync(BUNDLE_PATH)).toBe(true);
    expect(existsSync(ENTRY_SOURCE)).toBe(true);
    expect(bundle.length).toBeGreaterThan(2000);
  });

  it("contains no top-level import or export, so it loads as a classic script", () => {
    const moduleSyntax = bundle
      .split(/\r?\n/)
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter((entry) => /^(import|export)\b/.test(entry.text));

    expect(moduleSyntax).toEqual([]);
    expect(bundle).not.toMatch(/\bimport\s*\(/);
    expect(bundle).not.toMatch(/\brequire\s*\(/);
  });

  it("is wrapped in an immediately-invoked function", () => {
    const head = bundle.slice(0, 200);

    expect(head).toMatch(/\(\(\)\s*=>\s*\{/);
    expect(bundle.trimEnd().endsWith("})();")).toBe(true);
  });

  it("carries the perception code it needs", () => {
    expect(bundle).toContain("conversation-turn-");
    expect(bundle).toContain("CAPTURE_UPDATE");
    expect(bundle).toContain("DOM_SHAPE_UNRECOGNIZED");
  });

  it("carries no network, messaging or storage code (G8.2)", () => {
    expect(bundle).not.toContain("XMLHttpRequest");
    expect(bundle).not.toContain("connectNative");
    expect(bundle).not.toContain("chrome.storage");
    expect(bundle).not.toContain("nativeMessaging");
    expect(bundle).not.toContain("fetch(");
  });
});

describe("the manifest that loads it (6.17)", () => {
  function manifest(): Manifest {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  }

  it("declares the bundle as a content script and the file exists at the declared path", () => {
    const scripts = manifest().content_scripts ?? [];

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script.js).toContain("content.js");
      expect(script.run_at).toBe("document_idle");
      for (const file of script.js ?? []) {
        expect(existsSync(path.join(REPO_ROOT, "dist", file))).toBe(true);
      }
    }
  });

  it("matches only https provider pages", () => {
    const scripts = manifest().content_scripts ?? [];

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(script.matches?.length ?? 0).toBeGreaterThan(0);
      for (const match of script.matches ?? []) {
        expect(match.startsWith("https://")).toBe(true);
        expect(match.startsWith("http://")).toBe(false);
      }
    }
  });
});
