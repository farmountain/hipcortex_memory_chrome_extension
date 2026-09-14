/**
 * Install the CortexBridge native messaging host.
 *
 * No shebang line, for the same reason as `host/bridge-host.mjs`: the spec runner's transformer
 * does not strip one, so it makes this module unimportable. Run it as
 * `node scripts/install-host.mjs`, or via `npm run install:host`.
 *
 * `docs/PROTOCOL.md` §9 records the problem this file solves, which was that "no host installer
 * exists yet", so Consumer Mode could only ever be mocked. `README.md` repeated it under Known
 * limitations, and open risk 2 noted that Chrome's native-messaging registry on the development
 * machine lists six hosts and none is HipCortex. Every one of those statements described a product
 * that could not be installed — the extension dead-ended and told the user to check that something
 * they had never had was running. §9 and the README have since been rewritten to say what is now
 * executed; this comment keeps the history because it is the reason the file exists.
 *
 * A browser extension cannot fix this itself, and that is a security boundary rather than a gap:
 * `permissions` in `public/manifest.json` contains neither `downloads` nor `management`,
 * `chrome.runtime.connectNative` connects to an already-registered host and cannot create one, and
 * no extension API can write a registry key. An extension that *could* silently install a native
 * binary would be a privilege-escalation primitive, which is why the platform forbids it. So the
 * install step needs a user action. This script is that action, reduced to one command.
 *
 * What it writes — three things, all of which Chrome requires before a host is reachable:
 *   1. the host program itself, copied out of the repository to a stable per-user location;
 *   2. a host manifest declaring the program's absolute path, its `stdio` transport, and the
 *      extension origins allowed to connect to it (`allowed_origins`);
 *   3. the registration Chrome actually looks up — a registry value on Windows, a file in a
 *      browser-specific directory on macOS and Linux.
 *
 * Windows needs a fourth: Chrome will not execute a `.mjs` from a manifest, so a `.cmd` launcher
 * is generated and the manifest points at that.
 *
 * All path and manifest construction is a pure function so the specs can assert the exact bytes
 * that would be written without a test ever touching the real registry of the machine it runs on.
 * `--dry-run` prints the same plan for a human.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HOST_NAME = "com.hipcortex.bridge";
export const HOST_DESCRIPTION = "HipCortex CortexBridge — local capture delivery";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_HOST_PATH = path.join(REPO_ROOT, "host", "bridge-host.mjs");

/** The same manifest `scripts/copy-assets.js` copies into `dist/`; the source of truth for the key. */
export const SOURCE_MANIFEST_PATH = path.join(REPO_ROOT, "public", "manifest.json");

/** Chrome extension IDs are exactly 32 characters from `a` to `p`. */
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/** The browsers whose native-messaging registration this installer understands. */
export const BROWSERS = ["chrome", "chromium", "edge", "brave"];

export function isValidExtensionId(value) {
  return EXTENSION_ID_PATTERN.test(value);
}

/**
 * Derive the extension ID Chrome will assign, from the `key` the manifest pins.
 *
 * Without this the installer could not be run at all until after the extension had been loaded once,
 * because an unpacked extension's ID is otherwise derived from the absolute path of the loaded
 * directory and is unknowable from outside the browser. That made one of the two install orders
 * impossible in practice: the host could not be registered before the extension existed, so
 * `allowed_origins` had nothing to name. The `key` field fixes the ID, so the ID is now computable
 * offline and the host can be installed first.
 *
 * Chrome's rule, implemented rather than assumed: the ID is the first 16 bytes of the SHA-256 of the
 * public key's DER encoding, each hex nibble mapped onto `a`..`p`.
 *
 * @param {{ key?: unknown }} manifest a parsed `manifest.json`
 * @returns {string | null} the derived ID, or `null` if the manifest pins no usable key
 */
export function deriveExtensionId(manifest) {
  const key = manifest?.key;
  if (typeof key !== "string" || key.trim() === "") return null;
  const clean = key.trim();
  const bytes = Buffer.from(clean, "base64");

  /*
   * `Buffer.from(value, "base64")` never throws. It decodes as much as it can and ignores the rest,
   * so a malformed key still yields bytes, and those bytes still hash to a well-formed `[a-p]{32}`
   * ID. That would be the worst possible failure: a valid-looking ID naming a different extension,
   * surfacing in Chrome as a refused connection that never mentions the key. Round-tripping the
   * encoding, and requiring the DER SEQUENCE header, turns it into `null` — a typed failure instead
   * of a plausible wrong answer. Found by asserting the negative case, not the positive one.
   */
  if (bytes.length === 0 || bytes[0] !== 0x30 || bytes.toString("base64") !== clean) return null;

  const hex = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const id = [...hex].map((nibble) => "abcdefghijklmnop"[parseInt(nibble, 16)]).join("");
  return EXTENSION_ID_PATTERN.test(id) ? id : null;
}

/**
 * The ID the shipped manifest pins, read from disk at call time rather than baked in.
 *
 * Baking it would let the constant and the manifest drift, and the symptom of drift is a confusing
 * Chrome error rather than a failed build. Reading the manifest means there is one place the ID is
 * defined and the installer cannot disagree with it.
 *
 * @returns {string | null}
 */
export function defaultExtensionId() {
  try {
    return deriveExtensionId(JSON.parse(readFileSync(SOURCE_MANIFEST_PATH, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Join with the separator of the platform being **targeted**, not the one running.
 *
 * `path.join` uses the host's separator, so on Windows `path.join("/xdg", "hipcortex")` is
 * `\xdg\hipcortex`. The platform is a parameter here precisely so an install plan can be computed
 * for another machine, and the specs do exactly that — which is how this was caught.
 */
export function joinerFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * Where the host program and manifest are kept.
 *
 * Per-user, never system-wide: the host is registered under `HKCU` on Windows and in the user's
 * own config directory elsewhere, so installing it must not require elevation. A product that
 * needs an administrator prompt to record a memory is a product most people will not install.
 */
export function installDirFor({ platform, env, home }) {
  const join = joinerFor(platform).join;

  if (platform === "win32") {
    const localAppData = env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");
    return join(localAppData, "HipCortex");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "HipCortex");
  }
  const dataHome = env["XDG_DATA_HOME"] ?? join(home, ".local", "share");
  return join(dataHome, "hipcortex");
}

/**
 * The browser-specific directory Chrome reads host manifests from on macOS and Linux.
 *
 * Windows has no equivalent directory — registration there is a registry value — so this returns
 * `null` and `registryKeysFor` is used instead. The two are deliberately separate rather than one
 * "location" abstraction, because conflating them is how a Windows installer ends up writing a
 * manifest directory that Chrome never reads and reporting success.
 */
export function manifestDirFor({ platform, browser, home }) {
  if (platform === "win32") return null;

  const join = joinerFor(platform).join;
  const dirnames = {
    chrome: { darwin: ["Library", "Application Support", "Google", "Chrome"], linux: ["google-chrome"] },
    chromium: { darwin: ["Library", "Application Support", "Chromium"], linux: ["chromium"] },
    edge: { darwin: ["Library", "Application Support", "Microsoft Edge"], linux: ["microsoft-edge"] },
    brave: {
      darwin: ["Library", "Application Support", "BraveSoftware", "Brave-Browser"],
      linux: ["BraveSoftware", "Brave-Browser"],
    },
  };

  const entry = dirnames[browser];
  if (!entry) throw new Error(`unknown browser: ${browser}`);

  if (platform === "darwin") {
    return join(home, ...entry.darwin, "NativeMessagingHosts");
  }
  return join(home, ".config", ...entry.linux, "NativeMessagingHosts");
}

/** The `HKCU` keys Chrome, Chromium, Edge and Brave each read on Windows. */
export function registryKeysFor(browser) {
  const prefixes = {
    chrome: "Software\\Google\\Chrome",
    chromium: "Software\\Chromium",
    edge: "Software\\Microsoft\\Edge",
    brave: "Software\\BraveSoftware\\Brave-Browser",
  };

  const prefix = prefixes[browser];
  if (!prefix) throw new Error(`unknown browser: ${browser}`);
  return [`HKCU\\${prefix}\\NativeMessagingHosts\\${HOST_NAME}`];
}

/**
 * The host manifest Chrome validates.
 *
 * `allowed_origins` is the only reason this file exists rather than Chrome accepting any host: it
 * binds the host to one extension ID, so another extension cannot reuse a registered HipCortex
 * host to write into the user's memory. Getting the ID wrong produces a host that appears
 * installed and is nonetheless unreachable, which is why the ID is validated before anything is
 * written.
 */
export function buildManifest({ hostPath, extensionId }) {
  if (!isValidExtensionId(extensionId)) {
    throw new Error(
      `extension id must be 32 characters in a-p (received ${JSON.stringify(extensionId)}); ` +
        "find it at chrome://extensions with Developer mode enabled"
    );
  }

  return {
    name: HOST_NAME,
    description: HOST_DESCRIPTION,
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

/**
 * The Windows launcher.
 *
 * Chrome launches the manifest's `path` as an executable. A `.mjs` source file is not one, so the
 * manifest points at this launcher instead. `%*` forwards Chrome's arguments (it passes the
 * extension origin) and `1>&1`-style redirection is deliberately absent: stdout carries the
 * protocol and must not be decorated by the shell.
 *
 * `coreUrl` is omitted in the normal case, which lets the host fall back to `DEFAULT_CORE_URL`;
 * setting it is what a developer pointing at a non-default loopback port wants.
 *
 * @param {{ nodePath: string, hostPath: string, coreUrl?: string }} options
 */
export function buildWindowsLauncher({ nodePath, hostPath, coreUrl = undefined }) {
  const lines = [
    "@echo off",
    "rem Generated by scripts/install-host.mjs. Chrome launches this; it forwards stdio to the host.",
  ];
  if (coreUrl) lines.push(`set "HIPCORTEX_CORE_URL=${coreUrl}"`);
  lines.push(`"${nodePath}" "${hostPath}" %*`);
  return `${lines.join("\r\n")}\r\n`;
}

export function parseArgs(argv) {
  const options = { browsers: [], dryRun: false, uninstall: false, extensionId: undefined, coreUrl: undefined };

  for (const arg of argv) {
    if (arg === "--uninstall") options.uninstall = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--browser=")) options.browsers.push(arg.slice("--browser=".length));
    else if (arg.startsWith("--extension-id=")) options.extensionId = arg.slice("--extension-id=".length).trim();
    else if (arg.startsWith("--core-url=")) options.coreUrl = arg.slice("--core-url=".length).trim();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unrecognised argument: ${arg}`);
  }

  if (options.browsers.length === 0) options.browsers = [...BROWSERS];
  for (const browser of options.browsers) {
    if (!BROWSERS.includes(browser)) throw new Error(`unknown browser: ${browser}`);
  }
  return options;
}

/**
 * Compute every path an install would touch, without touching any of them.
 *
 * Separated from `install()` so the same plan can be printed by `--dry-run` and asserted by a spec.
 *
 * The types below are load-bearing rather than decorative. The specs import this module, so this
 * JSDoc is what makes `plan.targets[i].manifestPath` type-check there; without it, `browsers` is
 * inferred as `any`, which surfaced as an implicit-`any` error on the mapped target. `coreUrl` is
 * optional because an install that pins no URL is the normal case — the launcher then lets the host
 * fall back to `DEFAULT_CORE_URL`.
 *
 * @param {object} options
 * @param {string} options.platform the platform to plan **for**, which need not be the one running
 * @param {Record<string, string | undefined>} options.env
 * @param {string} options.home
 * @param {string[]} options.browsers
 * @param {string} options.extensionId
 * @param {string} [options.coreUrl] written into the launcher only when given
 * @param {string} options.nodePath
 * @returns {{
 *   installDir: string,
 *   hostPath: string,
 *   launcherPath: string | null,
 *   launcherContents: string | null,
 *   coreUrl: string | undefined,
 *   manifest: { name: string, description: string, path: string, type: string, allowed_origins: string[] },
 *   targets: Array<{ browser: string, kind: string, manifestPath: string, registryKey?: string }>,
 * }}
 */
export function planInstall({ platform, env, home, browsers, extensionId, coreUrl, nodePath }) {
  const join = joinerFor(platform).join;
  const installDir = installDirFor({ platform, env, home });
  const hostPath = join(installDir, "bridge-host.mjs");

  const usesLauncher = platform === "win32";
  const launcherPath = usesLauncher ? join(installDir, "bridge-host.cmd") : null;
  const manifestTarget = launcherPath ?? hostPath;

  const manifest = buildManifest({ hostPath: manifestTarget, extensionId });

  const targets = browsers.map((browser) => {
    if (platform === "win32") {
      return {
        browser,
        kind: "registry",
        registryKey: registryKeysFor(browser)[0],
        manifestPath: join(installDir, `${HOST_NAME}.${browser}.json`),
      };
    }
    const dir = manifestDirFor({ platform, browser, home });
    return { browser, kind: "file", manifestPath: join(dir, `${HOST_NAME}.json`) };
  });

  return {
    installDir,
    hostPath,
    launcherPath,
    launcherContents: usesLauncher ? buildWindowsLauncher({ nodePath, hostPath, coreUrl }) : null,
    manifest,
    coreUrl,
    targets,
  };
}

function writeAll(plan) {
  mkdirSync(plan.installDir, { recursive: true });
  copyFileSync(SOURCE_HOST_PATH, plan.hostPath);
  if (plan.launcherPath && plan.launcherContents) {
    writeFileSync(plan.launcherPath, plan.launcherContents, "utf8");
  }
  for (const target of plan.targets) {
    mkdirSync(path.dirname(target.manifestPath), { recursive: true });
    writeFileSync(target.manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`, "utf8");
    if (target.kind === "registry") {
      // `/f` overwrites, so re-running the installer is idempotent rather than an error.
      execFileSync("reg", ["add", target.registryKey, "/ve", "/t", "REG_SZ", "/d", target.manifestPath, "/f"], {
        stdio: ["ignore", "ignore", "pipe"],
      });
    }
  }
}

function removeAll(plan) {
  for (const target of plan.targets) {
    if (target.kind === "registry") {
      try {
        execFileSync("reg", ["delete", target.registryKey, "/f"], { stdio: ["ignore", "ignore", "pipe"] });
      } catch {
        // Absent is the desired end state, not a failure.
      }
    }
    rmSync(target.manifestPath, { force: true });
  }
  rmSync(plan.hostPath, { force: true });
  if (plan.launcherPath) rmSync(plan.launcherPath, { force: true });
}

function usage() {
  return [
    "Install the CortexBridge native messaging host.",
    "",
    "  node scripts/install-host.mjs [--extension-id=<id>] [options]",
    "  node scripts/install-host.mjs --uninstall [--browser=<name>]",
    "",
    "Options:",
    `  --extension-id=<id>   32 chars, a-p. Default: derived from the \`key\` in public/manifest.json`,
    `                         (${defaultExtensionId() ?? "unavailable — pass it explicitly"})`,
    `  --browser=<name>      ${BROWSERS.join(" | ")}. Repeatable. Default: all.`,
    "  --core-url=<url>      Loopback core base URL. Default: http://127.0.0.1:3030",
    "  --dry-run             Print the plan and write nothing.",
    "  --uninstall           Remove the host, its manifest and its registration.",
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const extensionId = options.extensionId ?? defaultExtensionId() ?? undefined;

  if (!options.uninstall && !extensionId) {
    process.stderr.write(
      [
        "--extension-id is required, because public/manifest.json pins no `key` to derive it from.",
        "Find the ID at chrome://extensions (Developer mode on) after loading dist/ unpacked.",
        "",
      ].join("\n") + `\n${usage()}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const plan = planInstall({
    platform: process.platform,
    env: process.env,
    home: homedir(),
    browsers: options.browsers,
    extensionId: extensionId ?? "",
    coreUrl: options.coreUrl,
    nodePath: process.execPath,
  });

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  if (options.uninstall) {
    removeAll(plan);
    process.stdout.write(`Removed ${HOST_NAME} for ${options.browsers.join(", ")}.\n`);
    return;
  }

  writeAll(plan);
  process.stdout.write(
    [
      `Installed ${HOST_NAME}.`,
      `  host:     ${plan.hostPath}`,
      `  manifest: ${plan.manifest.path}`,
      ...plan.targets.map((target) => `  ${target.browser}: ${target.kind === "registry" ? target.registryKey : target.manifestPath}`),
      "",
      "Reload the extension, then open Options and run the connection test.",
      "If the core is not running yet, the extension will now say so specifically.",
    ].join("\n") + "\n"
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
