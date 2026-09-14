/**
 * Package `dist/` into a store-uploadable zip (task 1.10).
 *
 * The old script was `cd dist && zip -r ...`, which needs both a POSIX shell and the `zip` binary.
 * This version uses `zip` on POSIX and PowerShell's `Compress-Archive` on Windows, and probes for
 * the tool before use so a missing binary produces a message naming it instead of an opaque
 * `ENOENT`.
 *
 * The archive root holds `manifest.json` directly — a zip that nests everything under `dist/`
 * installs as a broken extension, which is the failure this layout avoids.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

if (!existsSync(dist)) {
  console.error("[package] dist/ does not exist — run `npm run build` first");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const out = path.join(root, `hipcortex-chrome-extension-v${version}.zip`);

rmSync(out, { force: true });

function exit(missingTool) {
  console.error(`[package] required tool not found: ${missingTool}`);
  process.exit(1);
}

let result;

if (process.platform === "win32") {
  if (spawnSync("powershell", ["-NoProfile", "-Command", "exit 0"]).error) {
    exit("powershell");
  }
  const command = `Compress-Archive -Path '${path.join(dist, "*")}' -DestinationPath '${out}' -Force`;
  result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
    stdio: "inherit",
  });
} else {
  if (spawnSync("zip", ["-v"], { stdio: "ignore" }).error) {
    exit("zip");
  }
  result = spawnSync("zip", ["-r", out, "."], { cwd: dist, stdio: "inherit" });
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[package] wrote ${path.basename(out)}`);
