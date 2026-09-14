/**
 * Manifest and loadability specs (tasks 9.1–9.5, G1.9, G6.5).
 *
 * G6.5 says every path in `dist/manifest.json` resolves, the manifest requests no broad host
 * access, and no remote code is loaded. All three are properties of the *packaged* extension, so
 * they are asserted against `dist/`, not against `public/` — a manifest that is correct in the
 * source tree and broken in the package still ships broken.
 *
 * `dist/` is rebuilt when it is missing or stale. Reading whatever artifact happens to be on disk
 * would let a stale `dist/` mask a broken build, which is the failure this repository already
 * documents about the committed-output hazard. The staleness test is cheap: if the copied manifest
 * is older than the source manifest, the tree the user would load unpacked is not the tree the
 * sources describe.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";

import { beforeAll, describe, expect, it } from "vitest";

import { PUBLIC_DIR, REPO_ROOT, findViolations, scanSource, scanTree } from "../helpers/scan.js";

const DIST_DIR = path.join(REPO_ROOT, "dist");
const SOURCE_MANIFEST = path.join(PUBLIC_DIR, "manifest.json");
const DIST_MANIFEST = path.join(DIST_DIR, "manifest.json");

interface Manifest {
  manifest_version?: number;
  version?: string;
  icons?: Record<string, string>;
  action?: { default_popup?: string; default_icon?: Record<string, string> };
  background?: { service_worker?: string; type?: string };
  side_panel?: { default_path?: string };
  options_ui?: { page?: string };
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: { matches?: string[]; js?: string[]; css?: string[]; run_at?: string }[];
  commands?: Record<string, { description?: string; suggested_key?: Record<string, string> }>;
}

let manifest: Manifest;

/**
 * The three `npm run build` steps, run without a shell so the spec behaves the same on Windows and
 * POSIX. `npm test` runs before `npm run build` in the gate chain, so this spec cannot assume a
 * fresh artifact exists.
 */
function build(): void {
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
  execFileSync(process.execPath, ["scripts/build-content.js"], { cwd: REPO_ROOT, stdio: "pipe" });
  execFileSync(process.execPath, ["scripts/copy-assets.js"], { cwd: REPO_ROOT, stdio: "pipe" });
}

function artifactIsFresh(): boolean {
  if (!existsSync(DIST_MANIFEST)) return false;
  return statSync(DIST_MANIFEST).mtimeMs >= statSync(SOURCE_MANIFEST).mtimeMs;
}

beforeAll(() => {
  if (!artifactIsFresh()) build();
  manifest = JSON.parse(readFileSync(DIST_MANIFEST, "utf8")) as Manifest;
}, 180_000);

/** Every path in the manifest that points at a file in the package. */
function referencedPaths(parsed: Manifest): string[] {
  const found: string[] = [
    ...Object.values(parsed.icons ?? {}),
    ...Object.values(parsed.action?.default_icon ?? {}),
    ...(parsed.action?.default_popup ? [parsed.action.default_popup] : []),
    ...(parsed.background?.service_worker ? [parsed.background.service_worker] : []),
    ...(parsed.side_panel?.default_path ? [parsed.side_panel.default_path] : []),
    ...(parsed.options_ui?.page ? [parsed.options_ui.page] : []),
  ];
  for (const script of parsed.content_scripts ?? []) {
    found.push(...(script.js ?? []), ...(script.css ?? []));
  }
  return found;
}

/** The pages a user can reach, which is what the "no orphan HTML" check counts. */
function referencedPages(parsed: Manifest): string[] {
  return [
    ...(parsed.action?.default_popup ? [parsed.action.default_popup] : []),
    ...(parsed.side_panel?.default_path ? [parsed.side_panel.default_path] : []),
    ...(parsed.options_ui?.page ? [parsed.options_ui.page] : []),
  ];
}

function localReferences(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) found.push(match[1] as string);
  for (const match of html.matchAll(/<link[^>]*\shref="([^"]+)"/g)) found.push(match[1] as string);
  return found.filter((reference) => !/^(https?:)?\/\//.test(reference));
}

describe("every path in the packaged manifest resolves — G6.5 (task 9.1)", () => {
  it("references files at all, so the resolution check below cannot pass vacuously", () => {
    const referenced = referencedPaths(manifest);
    expect(referenced.length).toBeGreaterThanOrEqual(12);
    expect(referenced).toContain("background.js");
    expect(referenced).toContain("content.js");
    expect(referenced).toContain("popup.html");
    expect(referenced).toContain("sidepanel.html");
    expect(referenced).toContain("options.html");
  });

  it("resolves every referenced path inside dist/", () => {
    const missing = referencedPaths(manifest).filter(
      (reference) => !existsSync(path.join(DIST_DIR, reference))
    );
    expect(missing).toEqual([]);
  });

  it("is the manifest the source tree describes, not a stale copy", () => {
    expect(readFileSync(DIST_MANIFEST, "utf8")).toBe(readFileSync(SOURCE_MANIFEST, "utf8"));
    expect(manifest.version).toBe(
      (JSON.parse(readFileSync(SOURCE_MANIFEST, "utf8")) as Manifest).version
    );
  });
});

describe("the build emits every file the package needs — G6.4 (task 9.2)", () => {
  const REQUIRED = [
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    "sidepanel.html",
    "sidepanel.js",
    "options.html",
    "options.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
  ];

  it("writes each required artifact into dist/", () => {
    const missing = REQUIRED.filter((file) => !existsSync(path.join(DIST_DIR, file)));
    expect(missing).toEqual([]);
  });

  it("writes the script and stylesheet every page declares", () => {
    // This is the `copy-assets.js` hazard stated as a test: a page added to `public/` and omitted
    // from the copy list produces a packaged extension whose HTML loads a 404.
    const declared = scanTree(PUBLIC_DIR)
      .filter((file) => file.path.endsWith(".html"))
      .flatMap((file) => localReferences(file.content));
    expect(declared.length).toBeGreaterThanOrEqual(6);

    const missing = declared.filter(
      (reference) => !existsSync(path.join(DIST_DIR, path.basename(reference)))
    );
    expect(missing).toEqual([]);
  });
});

describe("the packaged icons are the size they claim — task 9.2", () => {
  /** The width, height and decoded RGBA scanlines of a PNG, read from its own chunks. */
  function png(bytes: Buffer): { width: number; height: number; pixels: Buffer } {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.subarray(0, 8).equals(signature)).toBe(true);
    expect(bytes.subarray(12, 16).toString("latin1")).toBe("IHDR");

    const data: Buffer[] = [];
    let position = 8;
    while (position + 8 <= bytes.length) {
      const length = bytes.readUInt32BE(position);
      const type = bytes.subarray(position + 4, position + 8).toString("latin1");
      if (type === "IEND") break;
      if (type === "IDAT") data.push(bytes.subarray(position + 8, position + 8 + length));
      position += 12 + length;
    }

    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    // A PNG's IDAT is a zlib stream (RFC 1950), and every scanline the build writes uses filter
    // type 0, so the inflated bytes are 1 + 4 per pixel.
    return { width, height, pixels: inflateSync(Buffer.concat(data)) };
  }

  /** The RGBA of one pixel, given the raw filtered scanlines. */
  function pixel(pixels: Buffer, width: number, x: number, y: number): number[] {
    const start = y * (1 + width * 4) + 1 + x * 4;
    return [...pixels.subarray(start, start + 4)];
  }

  it("writes each icon at the size the manifest's key declares", () => {
    // The manifest's `icons` map only names files, so before this test a 1x1 transparent placeholder
    // satisfied every other check in this file while the store submission would have been rejected.
    const icons = Object.entries(manifest.icons ?? {});
    expect(icons.length).toBeGreaterThanOrEqual(4);

    for (const [declared, file] of icons) {
      const size = Number(declared);
      expect(Number.isInteger(size), `${declared} is not a pixel size`).toBe(true);
      const image = png(readFileSync(path.join(DIST_DIR, file)));
      expect([image.width, image.height], `${file} should be ${size}x${size}`).toEqual([size, size]);
    }
  });

  it("ships a usable 128x128 icon, which the store requires inside the archive", () => {
    // A 128x128 all-transparent PNG satisfies the dimension rule and is still unusable, so the
    // artwork is decoded: transparent padding at the edge, opaque ink in the middle.
    const image = png(readFileSync(path.join(DIST_DIR, "icons/icon128.png")));

    expect([image.width, image.height]).toEqual([128, 128]);
    expect(image.pixels.length).toBe(128 * (1 + 128 * 4));
    expect(pixel(image.pixels, 128, 0, 0)[3]).toBe(0);
    expect(pixel(image.pixels, 128, 64, 64)[3]).toBe(255);
  });
});

describe("no page ships that nothing links to — task 9.3", () => {
  it("references every HTML file in public/ from the manifest", () => {
    const pages = referencedPages(manifest).map((page) => path.basename(page));
    const shipped = scanTree(PUBLIC_DIR)
      .filter((file) => file.path.endsWith(".html"))
      .map((file) => path.basename(file.path));

    expect(shipped.length).toBeGreaterThanOrEqual(3);
    expect(shipped.sort()).toEqual([...pages].sort());
  });

  it("gives every declared command a description", () => {
    const commands = Object.values(manifest.commands ?? {});
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect((command.description ?? "").length).toBeGreaterThan(0);
    }
  });
});

describe("manifest invariants — least privilege (task 9.4)", () => {
  const LOOPBACKS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

  /** The permission set is closed: a new permission must arrive with a usage or a stated reason. */
  const USED_PERMISSIONS: Record<string, RegExp> = {
    storage: /chrome\.storage\./,
    contextMenus: /chrome\.contextMenus\./,
    sidePanel: /chrome\.sidePanel/,
    scripting: /chrome\.scripting\./,
    nativeMessaging: /chrome\.runtime\.connectNative\s*\(/,
    alarms: /chrome\.alarms\./,
  };
  /** Granted for the gesture, not for an API: it exposes no `chrome.activeTab` surface. */
  const GESTURE_ONLY = ["activeTab"];

  it("is Manifest V3", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background?.type).toBe("module");
  });

  it("requests no broad host access", () => {
    const permissions = [
      ...(manifest.host_permissions ?? []),
      ...(manifest.optional_host_permissions ?? []),
      ...(manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
    ];
    expect(permissions.length).toBeGreaterThan(0);
    expect(permissions.filter((entry) => /<all_urls>|\*:\/\//.test(entry))).toEqual([]);
  });

  it("keeps every required host on the machine that runs the extension", () => {
    const hosts = manifest.host_permissions ?? [];
    expect(hosts.length).toBeGreaterThan(0);

    for (const pattern of hosts) {
      const host = new URL(pattern.replace(/\*$/, "")).hostname;
      expect(LOOPBACKS.has(host), `${pattern} is not a loopback host`).toBe(true);
    }
  });

  it("lists every provider host as optional and none as required (G1.9)", () => {
    const optional = manifest.optional_host_permissions ?? [];
    const required = manifest.host_permissions ?? [];

    expect(optional).toContain("https://chatgpt.com/*");
    expect(optional).toContain("https://chat.openai.com/*");
    expect(optional).toContain("https://claude.ai/*");
    expect(optional).toContain("https://gemini.google.com/*");
    expect(optional).toContain("https://grok.com/*");
    expect(optional).toContain("https://chat.deepseek.com/*");
    expect(required.filter((host) => host.startsWith("https://"))).toEqual([]);
  });

  it("declares only permissions that are used or have a recorded reason", () => {
    const declared = [...(manifest.permissions ?? [])].sort();
    const justified = [...Object.keys(USED_PERMISSIONS), ...GESTURE_ONLY].sort();

    expect(declared).toEqual(justified);
    expect(declared).toContain("activeTab");
  });

  it("uses each declared permission somewhere in the sources", () => {
    const files = scanSource();
    expect(files.length).toBeGreaterThan(0);

    for (const [permission, pattern] of Object.entries(USED_PERMISSIONS)) {
      if (!(manifest.permissions ?? []).includes(permission)) continue;
      expect(
        findViolations(files, pattern).length,
        `${permission} is declared but no source uses it`
      ).toBeGreaterThan(0);
    }
  });
});

describe("no remote code anywhere in the package — G6.5 (task 9.5)", () => {
  /** Code that could be assembled from a string at runtime. */
  const DYNAMIC_CODE = /\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]/;
  /** A script tag pointing somewhere that is not the extension itself. */
  const REMOTE_SCRIPT = /<script[^>]+src\s*=\s*["'](https?:)?\/\//i;

  it("loads no code the extension did not ship", () => {
    const production = scanSource();
    const shipped = scanTree(PUBLIC_DIR);

    expect(production.length).toBeGreaterThan(0);
    expect(findViolations(production, DYNAMIC_CODE)).toEqual([]);
    expect(findViolations(shipped, DYNAMIC_CODE)).toEqual([]);
    expect(findViolations(shipped, REMOTE_SCRIPT)).toEqual([]);
  });

  it("would notice dynamic code if it were present, so the check is not vacuous", () => {
    const synthetic = [{ path: "src/synthetic.ts", content: 'const f = new Function("return 1");' }];
    expect(findViolations(synthetic, DYNAMIC_CODE)).toHaveLength(1);
  });

  it("loads every page's scripts from the package itself", () => {
    const html = scanTree(PUBLIC_DIR).filter((file) => file.path.endsWith(".html"));
    expect(html.length).toBeGreaterThanOrEqual(3);

    for (const file of html) {
      expect(file.content).toMatch(/<script[^>]+src="[^"]+"/);
      expect(file.content).not.toMatch(REMOTE_SCRIPT);
    }
  });
});
