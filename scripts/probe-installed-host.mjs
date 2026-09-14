/**
 * Live verification of the installed native messaging host, on this machine, right now.
 *
 *     node scripts/probe-installed-host.mjs
 *
 * Deliberately not a spec and deliberately not part of `npm run verify`. A spec must never touch the
 * real registry, the real install directory or the user's live core, and this is a standalone
 * command whose whole point is to be the thing a spec cannot be: evidence about the product on a real
 * machine rather than about a mock. Registration itself writes into the user's home directory, so it
 * is a command a person runs — and this is the check that says whether it worked.
 *
 * What it establishes, in order:
 *   1. what `reg query` actually answers for the registered host key;
 *   2. that the host manifest the registry names exists and what it says;
 *   3. that the program it points at exists;
 *   4. that the **installed** artefact answers a health frame, spawned the way Chrome spawns it
 *      (a `.cmd` through `cmd.exe`, because Node cannot spawn a `.cmd` directly);
 *   5. that the host file invoked directly agrees, so a broken launcher cannot be mistaken for a
 *      broken host;
 *   6. that an unrecognised control message is refused locally rather than forwarded to the core;
 *   7. whether the core the host forwards to is actually up, and at which version.
 *
 * It sends **no capture**. A health request reads `GET /health` and writes nothing, so the user's
 * real memory store is not touched. Sending a capture here would write a synthetic record into live
 * memory, which is a mistake this repository has already made once.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

import { BROWSERS, HOST_NAME, installDirFor, registryKeysFor } from "./install-host.mjs";

const platform = process.platform;
const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
const installDir = installDirFor({ platform, env: process.env, home });
const [registryKey] = registryKeysFor(BROWSERS[0]);

function encode(value) {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

/** Ask a host process one question over its real stdio and resolve its framed reply. */
function ask(command, args, request, label) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let buffered = Buffer.alloc(0);
    let stderr = "";
    const done = (result) => {
      child.kill();
      resolve({ label, ...result });
    };
    const timer = setTimeout(() => done({ reply: null, stderr, note: "timeout" }), 12000);

    child.stdout.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32LE(0);
      if (buffered.length < 4 + length) return;
      clearTimeout(timer);
      done({ reply: JSON.parse(buffered.subarray(4, 4 + length).toString("utf8")), stderr });
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ reply: null, stderr: String(error) });
    });

    child.stdin.write(encode(request));
  });
}

console.log(`install dir   : ${installDir}`);
console.log(`host name     : ${HOST_NAME}`);

console.log("\n=== 1. what the registry actually answers ===");
let manifestPath = null;
try {
  const registered = execFileSync("reg", ["query", registryKey, "/ve"], { encoding: "utf8" });
  console.log(registered.trim());
  manifestPath = /REG_SZ\s+(.+)/.exec(registered)?.[1]?.trim() ?? null;
} catch (error) {
  console.log(`NOT REGISTERED for ${BROWSERS[0]} — run: npm run install:host`);
  console.log(String(error).split("\n")[0]);
}

if (manifestPath !== null) {
  console.log(`host manifest : ${manifestPath} (exists: ${existsSync(manifestPath)})`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  console.log(JSON.stringify(manifest, null, 2));
  console.log(`program target: ${manifest.path} (exists: ${existsSync(manifest.path)})`);

  console.log("\n=== 2. the installed program, spawned the way Chrome spawns it ===");
  // Chrome launches the registered `path` through CreateProcess, which runs a `.cmd` via cmd.exe.
  console.log(JSON.stringify(await ask(process.env.ComSpec, ["/c", manifest.path], { type: "health" }, "via launcher")));

  console.log("\n=== 3. control: the copied host program directly, bypassing the launcher ===");
  const hostPath = manifest.path.replace(/bridge-host\.cmd$/, "bridge-host.mjs");
  console.log(JSON.stringify(await ask(process.execPath, [hostPath], { type: "health" }, "direct")));

  console.log("\n=== 4. a request the host must refuse rather than forward ===");
  console.log(JSON.stringify(await ask(process.execPath, [hostPath], { type: "not-a-real-request" }, "unknown type")));
}

console.log("\n=== 5. is the core this host forwards to actually up? ===");
try {
  const response = await fetch("http://127.0.0.1:3030/health");
  console.log(`GET /health -> HTTP ${response.status} ${JSON.stringify(await response.json())}`);
} catch (error) {
  console.log(`GET /health -> ${String(error)} — the host should report this as core unreachable, not as host missing`);
}
