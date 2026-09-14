/**
 * End-to-end: the host as Chrome runs it — G9.1, G9.5, `docs/PROTOCOL.md` §9.
 *
 * This spec spawns the real host as a child process, writes a real length-prefixed frame to its
 * stdin, and reads a real frame back from its stdout, with a real HTTP server standing in for the
 * core. Nothing is mocked, so it exercises the parts unit tests cannot reach: that the file is
 * valid ESM when executed outside the repository (where there is no `package.json` to declare
 * `"type": "module"`), that `main()` starts when invoked rather than only when imported, that
 * stdout carries the protocol and nothing else, that replies are serialised so two frames cannot
 * interleave, and that the process exits when stdin closes instead of orphaning itself after every
 * service-worker restart.
 *
 * The distinction under test is the one the product was missing. Before this, "the host is not
 * installed" and "the host is installed but the core is down" both surfaced as
 * `HOST_UNAVAILABLE` with the advice "Check that HipCortex is running" — advice that cannot help
 * someone who has never installed HipCortex, which is everyone installing the extension for the
 * first time.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { encodeMessage } from "../../host/bridge-host.mjs";
import { REPO_ROOT } from "../helpers/scan.js";

const HOST_PATH = path.join(REPO_ROOT, "host", "bridge-host.mjs");

const children: ChildProcessWithoutNullStreams[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill();
  for (const server of servers.splice(0)) server.close();
});

/** Decode one frame from a buffer, mirroring Chrome's reader. */
function decode(buffer: Buffer): unknown {
  return JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32LE(0)).toString("utf8"));
}

/** Read exactly one framed reply from the child's stdout. */
function readFrame(child: ChildProcessWithoutNullStreams): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 4) return;
      const length = buffered.readUInt32LE(0);
      if (buffered.length < 4 + length) return;
      child.stdout.off("data", onData);
      resolve(decode(buffered));
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => reject(new Error(`host exited early with code ${code}`)));
    setTimeout(() => reject(new Error("timed out waiting for a reply from the host")), 8000);
  });
}

function startHost(coreUrl: string | undefined): ChildProcessWithoutNullStreams {
  const env = { ...process.env };
  if (coreUrl) env["HIPCORTEX_CORE_URL"] = coreUrl;
  else delete env["HIPCORTEX_CORE_URL"];

  const child = spawn(process.execPath, [HOST_PATH], { stdio: ["pipe", "pipe", "pipe"], env });
  children.push(child);
  return child;
}

async function startCore(reply: { status: number; body: string }): Promise<string> {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(reply.status, { "Content-Type": "application/json" });
      response.end(reply.body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const ADD_BODY = { actor: "hipcortex-chatgpt", action: "captured", target: "a conversation", metadata: {} };

describe("the host as Chrome runs it", () => {
  it("delivers a capture and returns the core's acknowledgement", async () => {
    const coreUrl = await startCore({ status: 200, body: JSON.stringify({ success: true, record_id: "rec-42" }) });
    const child = startHost(coreUrl);

    const reply = readFrame(child);
    child.stdin.write(encodeMessage(ADD_BODY));

    expect(await reply).toEqual({ success: true, record_id: "rec-42" });
  });

  it("answers with a typed failure when the core is not running", async () => {
    // Not a crash and not a silent disconnect: an answer the extension can render as
    // "installed, but the core is not running" — which is a different sentence from
    // "there is no host on this machine".
    const child = startHost("http://127.0.0.1:1");

    const reply = readFrame(child);
    child.stdin.write(encodeMessage(ADD_BODY));

    const body = (await reply) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/not reachable/i);
  });

  it("reports a failure that names the URL it tried, not a bare disconnect", async () => {
    // The default URL is asserted by a pure unit spec instead (`framing.spec.ts`), because spawning
    // the host with *no* override would post to `127.0.0.1:3030` — which on a developer's machine is
    // their live core. A spec must never write a synthetic record into a real memory store, and a
    // spec whose result depends on whether the user has the core running is not a spec at all.
    const child = startHost("http://127.0.0.1:9");

    const reply = readFrame(child);
    child.stdin.write(encodeMessage(ADD_BODY));

    const body = (await reply) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("127.0.0.1:9");
  });

  it("replies to each message in order, one frame per request", async () => {
    const coreUrl = await startCore({ status: 200, body: JSON.stringify({ success: true, record_id: "rec-1" }) });
    const child = startHost(coreUrl);

    const collected: Buffer = await new Promise((resolve, reject) => {
      let buffered = Buffer.alloc(0);
      child.stdout.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32LE(0) * 2) resolve(buffered);
      });
      setTimeout(() => reject(new Error("timed out")), 8000);
      // Both frames in one write: concurrency here is what would interleave two replies into one
      // malformed stream, which Chrome reports as a protocol error rather than as two messages.
      child.stdin.write(Buffer.concat([encodeMessage(ADD_BODY), encodeMessage(ADD_BODY)]));
    });

    const first = decode(collected);
    expect(first).toEqual({ success: true, record_id: "rec-1" });
    const rest = collected.subarray(4 + collected.readUInt32LE(0));
    expect(decode(rest)).toEqual({ success: true, record_id: "rec-1" });
  });

  it("exits when stdin closes, so a restarted worker leaves no orphan host", async () => {
    const child = startHost("http://127.0.0.1:3030");
    const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

    child.stdin.end();

    expect(await exited).toBe(0);
  });
});
