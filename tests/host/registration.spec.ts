/**
 * Host registration planning — G9.1, G9.3, G9.4.
 *
 * These specs assert the exact bytes an install would write, on all three platforms, **without
 * writing any of them**. That constraint is the point: an installer test that exercised
 * `writeAll()` would add a registry value to whatever machine ran `npm test`, and a test suite that
 * mutates the developer's system is not a test suite. So `planInstall()` is pure by design and
 * everything that touches the machine lives behind `writeAll`/`removeAll`, which no spec calls.
 *
 * The four facts being pinned are the four ways a native messaging host silently fails to be
 * reachable:
 *   1. `allowed_origins` must name the extension, or Chrome refuses the connection;
 *   2. `path` must be absolute and must point at something executable — on Windows a `.mjs` is not
 *      executable, so a launcher is required;
 *   3. the manifest must land in the directory (or under the registry key) that the *particular*
 *      browser reads, not a plausible-looking one;
 *   4. the registration is per-user, so installing never needs administrator rights.
 */

import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BROWSERS,
  HOST_NAME,
  SOURCE_MANIFEST_PATH,
  buildManifest,
  buildWindowsLauncher,
  defaultExtensionId,
  deriveExtensionId,
  installDirFor,
  isValidExtensionId,
  manifestDirFor,
  parseArgs,
  planInstall,
  registryKeysFor,
} from "../../scripts/install-host.mjs";

const VALID_ID = "abcdefghijklmnopabcdefghijklmnop";

/**
 * Homes are literals and expectations are built with `path.posix` / `path.win32`, because these
 * specs deliberately plan installs for platforms other than the one running them. Using the host's
 * `path.join` here would make a Windows run assert `\xdg\hipcortex` for a Linux target.
 */
const POSIX_HOME = "/home/user";
const WIN_HOME = "C:\\Users\\u";
const WIN_LOCAL_APPDATA = "C:\\Users\\u\\AppData\\Local";

describe("extension id validation", () => {
  it("accepts 32 characters from a to p", () => {
    expect(isValidExtensionId(VALID_ID)).toBe(true);
  });

  it("rejects anything else, because a wrong id produces a host that looks installed and is not", () => {
    for (const bad of ["", "abc", VALID_ID.slice(0, 31), `${VALID_ID.slice(0, 31)}z`, VALID_ID.toUpperCase()]) {
      expect(isValidExtensionId(bad), bad).toBe(false);
    }
  });
});

describe("the host manifest", () => {
  it("declares the stdio transport, an absolute path and the extension origin", () => {
    const manifest = buildManifest({ hostPath: "/opt/hipcortex/bridge-host.mjs", extensionId: VALID_ID });
    expect(manifest).toEqual({
      name: HOST_NAME,
      description: expect.any(String),
      path: "/opt/hipcortex/bridge-host.mjs",
      type: "stdio",
      allowed_origins: [`chrome-extension://${VALID_ID}/`],
    });
  });

  it("refuses to build a manifest for an invalid id rather than writing an unreachable host", () => {
    expect(() => buildManifest({ hostPath: "/x", extensionId: "nope" })).toThrow(/32 characters in a-p/);
  });

  it("names the host the native transport actually connects to", () => {
    // src/api/transport/native.ts hard-codes NATIVE_HOST; a mismatch here is a host that installs
    // perfectly and is never found.
    expect(HOST_NAME).toBe("com.hipcortex.bridge");
  });
});

describe("per-user install location", () => {
  it("writes under the user's own directories on every platform, never a system path", () => {
    const windows = installDirFor({ platform: "win32", env: { LOCALAPPDATA: WIN_LOCAL_APPDATA }, home: WIN_HOME });
    const mac = installDirFor({ platform: "darwin", env: {}, home: POSIX_HOME });
    const linux = installDirFor({ platform: "linux", env: {}, home: POSIX_HOME });

    expect(windows).toBe(path.win32.join(WIN_LOCAL_APPDATA, "HipCortex"));
    expect(mac).toBe(path.posix.join(POSIX_HOME, "Library", "Application Support", "HipCortex"));
    expect(linux).toBe(path.posix.join(POSIX_HOME, ".local", "share", "hipcortex"));

    // No elevation anywhere: a product that needs an administrator prompt to record a memory is
    // one most people will not install.
    for (const dir of [windows, mac, linux]) {
      expect(dir.toLowerCase()).not.toContain("program files");
      expect(dir).not.toMatch(/^\/(etc|usr|opt)\b/);
    }
  });

  it("honours XDG_DATA_HOME on Linux", () => {
    expect(installDirFor({ platform: "linux", env: { XDG_DATA_HOME: "/xdg" }, home: POSIX_HOME })).toBe(
      "/xdg/hipcortex"
    );
  });

  it("builds a path with the targeted platform's separator, not the running host's", () => {
    // The regression this pins: `path.join` on Windows turns a Linux install path into
    // `\xdg\hipcortex`, and the installer would then write a host Chrome never looks for.
    const linux = installDirFor({ platform: "linux", env: { XDG_DATA_HOME: "/xdg" }, home: POSIX_HOME });
    expect(linux).not.toContain("\\");

    const windows = installDirFor({ platform: "win32", env: { LOCALAPPDATA: WIN_LOCAL_APPDATA }, home: WIN_HOME });
    expect(windows).toContain("\\");
  });
});

describe("browser registration targets", () => {
  it("has no manifest directory on Windows, where registration is a registry value", () => {
    expect(manifestDirFor({ platform: "win32", browser: "chrome", home: WIN_HOME })).toBeNull();
  });

  it("names the directory each browser reads on macOS and Linux", () => {
    expect(manifestDirFor({ platform: "darwin", browser: "chrome", home: POSIX_HOME })).toBe(
      path.posix.join(POSIX_HOME, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts")
    );
    expect(manifestDirFor({ platform: "linux", browser: "chrome", home: POSIX_HOME })).toBe(
      path.posix.join(POSIX_HOME, ".config", "google-chrome", "NativeMessagingHosts")
    );
    expect(manifestDirFor({ platform: "linux", browser: "edge", home: POSIX_HOME })).toBe(
      path.posix.join(POSIX_HOME, ".config", "microsoft-edge", "NativeMessagingHosts")
    );
  });

  it("names the HKCU key each browser reads on Windows", () => {
    expect(registryKeysFor("chrome")).toEqual([
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    ]);
    expect(registryKeysFor("edge")[0]).toContain("Microsoft\\Edge");
    // HKCU, not HKLM: registering under HKLM would require elevation.
    for (const browser of BROWSERS) {
      expect(registryKeysFor(browser)[0]!.startsWith("HKCU\\")).toBe(true);
    }
  });

  it("rejects a browser it cannot register with instead of guessing a path", () => {
    expect(() => registryKeysFor("netscape")).toThrow(/unknown browser/);
    expect(() => manifestDirFor({ platform: "linux", browser: "netscape", home: POSIX_HOME })).toThrow(
      /unknown browser/
    );
  });
});

describe("the Windows launcher", () => {
  it("executes the host through node and forwards Chrome's arguments", () => {
    const launcher = buildWindowsLauncher({ nodePath: "C:\\node\\node.exe", hostPath: "C:\\HipCortex\\bridge-host.mjs" });
    expect(launcher).toContain("C:\\node\\node.exe");
    expect(launcher).toContain("C:\\HipCortex\\bridge-host.mjs");
    expect(launcher).toContain("%*");
  });

  it("sends nothing to stdout, which carries the protocol", () => {
    // A launcher that echoes anything desynchronises the stream and Chrome disconnects the host.
    const launcher = buildWindowsLauncher({ nodePath: "n", hostPath: "h" });
    const noisy = launcher.split(/\r?\n/).filter((line) => line && !line.startsWith("@echo off") && !line.startsWith("rem"));
    for (const line of noisy) {
      expect(line).not.toMatch(/\becho\b/i);
      expect(line).not.toMatch(/^\s*>/);
    }
  });

  it("pins the core URL into the launcher only when one was given", () => {
    expect(buildWindowsLauncher({ nodePath: "n", hostPath: "h" })).not.toContain("HIPCORTEX_CORE_URL");
    expect(
      buildWindowsLauncher({ nodePath: "n", hostPath: "h", coreUrl: "http://127.0.0.1:9999" })
    ).toContain("http://127.0.0.1:9999");
  });
});

/**
 * G9.5, and the reason the `key` field exists in `public/manifest.json`.
 *
 * An unpacked extension's ID is derived from the absolute path of the loaded directory unless the
 * manifest pins a `key`. Without one, the ID is unknowable until after the first load, so the
 * host-first install order cannot happen at all, and G9.5's "both orders" claim would be assertion
 * about a mock rather than a statement about the product. These specs check that the shipped
 * manifest really does pin an ID and that the installer derives the same one Chrome would.
 */
describe("the extension id the shipped manifest pins", () => {
  it("derives a well-formed id from the manifest's own key", () => {
    const derived = defaultExtensionId();
    expect(derived).not.toBeNull();
    expect(isValidExtensionId(derived!)).toBe(true);
  });

  it("derives it by Chrome's rule rather than by something adjacent to it", () => {
    // The rule, restated independently of the implementation: first 16 bytes of the SHA-256 of the
    // key's DER encoding, each hex nibble mapped onto a..p.
    const manifest = JSON.parse(readFileSync(SOURCE_MANIFEST_PATH, "utf8")) as { key: string };
    const hex = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
    const expected = [...hex].map((nibble) => "abcdefghijklmnop"[parseInt(nibble, 16)]).join("");
    expect(defaultExtensionId()).toBe(expected);
    expect(defaultExtensionId()).toMatch(/^[a-p]{32}$/);
  });

  it("names that id in allowed_origins, which is the only thing Chrome checks", () => {
    const plan = planInstall({
      platform: "win32",
      env: { LOCALAPPDATA: WIN_LOCAL_APPDATA },
      home: WIN_HOME,
      browsers: ["chrome"],
      extensionId: defaultExtensionId()!,
      nodePath: "C:\\node\\node.exe",
    });
    expect(plan.manifest.allowed_origins).toEqual([`chrome-extension://${defaultExtensionId()}/`]);
  });

  it("returns null rather than a plausible constant when the manifest pins nothing", () => {
    expect(deriveExtensionId({})).toBeNull();
    expect(deriveExtensionId({ key: "" })).toBeNull();
    expect(deriveExtensionId({ key: "not base64 at all" })).toBeNull();
  });
});

describe("the install plan", () => {
  const base = { env: {}, home: POSIX_HOME, browsers: ["chrome"], extensionId: VALID_ID, nodePath: "/usr/bin/node" };

  it("on Windows points the manifest at the launcher, not at the source file", () => {
    const plan = planInstall({
      ...base,
      platform: "win32",
      home: WIN_HOME,
      env: { LOCALAPPDATA: WIN_LOCAL_APPDATA },
      nodePath: "C:\\node\\node.exe",
    });
    expect(plan.launcherPath).toBe(path.win32.join(plan.installDir, "bridge-host.cmd"));
    expect(plan.manifest.path).toBe(plan.launcherPath);
    expect(plan.manifest.path).not.toBe(plan.hostPath);
    expect(plan.targets[0]!.kind).toBe("registry");
  });

  it("on Linux points the manifest at the host and writes to the browser's directory", () => {
    const plan = planInstall({ ...base, platform: "linux" });
    expect(plan.launcherPath).toBeNull();
    expect(plan.manifest.path).toBe(plan.hostPath);
    expect(plan.targets[0]!.kind).toBe("file");
    expect(plan.targets[0]!.manifestPath).toBe(
      path.posix.join(POSIX_HOME, ".config", "google-chrome", "NativeMessagingHosts", `${HOST_NAME}.json`)
    );
  });

  it("gives each browser its own manifest file on Windows", () => {
    // One shared manifest path would mean the last browser registered wins and the others point at
    // a file whose contents were overwritten.
    const plan = planInstall({
      ...base,
      platform: "win32",
      home: WIN_HOME,
      env: { LOCALAPPDATA: WIN_LOCAL_APPDATA },
      browsers: [...BROWSERS],
    });
    const paths = plan.targets.map((target) => target.manifestPath);
    expect(new Set(paths).size).toBe(BROWSERS.length);
  });

  it("defaults to every supported browser when none is chosen", () => {
    expect(parseArgs([`--extension-id=${VALID_ID}`]).browsers).toEqual([...BROWSERS]);
  });

  it("rejects an unknown flag or browser instead of quietly ignoring it", () => {
    expect(() => parseArgs(["--tls"])).toThrow(/unrecognised argument/);
    expect(() => parseArgs(["--browser=firefox"])).toThrow(/unknown browser/);
  });
});
