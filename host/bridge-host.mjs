/**
 * CortexBridge native messaging host.
 *
 * No shebang line, deliberately. Node strips one when the file is executed directly, but the
 * transformer used by the spec runner does not, so a leading `#!` makes this module unimportable
 * and the failure is reported as "Invalid or unexpected token" — against the importing spec, at the
 * position of the import specifier, which points at nothing. The host is always launched as
 * `node bridge-host.mjs`, by the npm scripts and by the `.cmd` launcher the installer generates, so
 * nothing needs a shebang. Do not add one back.
 *
 * This is the second half of the product. Without a registered host, Consumer Mode never connects
 * and `chrome.runtime.connectNative` reports a missing host. The extension used to answer that with
 * "Check that HipCortex is running" — advice that cannot help someone who never had HipCortex
 * installed; it now reports the not-registered state and names `npm run install:host` instead
 * (G9.1, G9.2). `scripts/install-host.mjs` registers this file; this file is what makes that
 * registration mean something.
 *
 * What it is: a transport shim. Chrome speaks Native Messaging (length-prefixed JSON over
 * stdio); the HipCortex core speaks HTTP on loopback. This process translates between the two and
 * does nothing else. It holds no memory, makes no decisions, and extracts no meaning from the
 * payload it forwards — the same boundary `AGENTS.md` draws around the extension, drawn again on
 * the host side. A shim that inspected captures would be a second, unreviewed place for cognition
 * to enter the system.
 *
 * The `.mjs` extension is deliberate. The installer copies this file outside the repository, where
 * there is no `package.json` to declare `"type": "module"`; `.js` would be read as CommonJS there
 * and the `export` statements below would be a syntax error at runtime, on the user's machine,
 * after a successful install.
 *
 * Wire contract (docs/PROTOCOL.md §9 — now executable rather than assumed):
 *   in   : one add body, exactly `toAddBody(record)` from src/api/transport/endpoints.ts
 *   out  : the core's own reply, e.g. `{ success: true, record_id: "<id>" }` or `{ success: false, error }`
 * The reply is passed through uninterpreted so the acknowledgement rule stays implemented once, in
 * the extension (`src/api/transport/acknowledge.ts`).
 *
 * Framing (Chrome's documented protocol, not ours to choose):
 *   [ 4 bytes little-endian uint32 length ][ length bytes of UTF-8 JSON ]
 *
 * stdout carries the protocol. Diagnostics go to stderr, because a stray `console.log` on stdout
 * desynchronises the stream and Chrome disconnects the host.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";

/** Loopback only, for the same reason `host_permissions` holds loopback only. */
export const DEFAULT_CORE_URL = "http://127.0.0.1:3030";
export const REQUEST_TIMEOUT_MS = 8000;

/**
 * Resolve the core URL from the environment, falling back to the documented loopback default.
 *
 * Exported so the default can be asserted without a spec spawning the host against port 3030.
 * That is not a tidiness point: on a machine where the core *is* running, a spec that posts to the
 * default URL writes a synthetic record into the user's real memory store. A test that mutates the
 * thing under test is worse than no test.
 */
export function resolveCoreUrl(env = {}) {
  const configured = env["HIPCORTEX_CORE_URL"];
  return configured !== undefined && configured.trim() !== "" ? configured.trim() : DEFAULT_CORE_URL;
}

/**
 * Loopback means `localhost`, `127.0.0.0/8`, or `::1`. Mirrors `isLoopbackUrl` in
 * `src/api/transport/endpoints.ts`; a non-loopback core would mean captures leave the machine
 * without the confirmation G7.2 requires, so the host refuses rather than quietly forwarding.
 */
export function isLoopbackUrl(raw) {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host === "::1") return true;
    return /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(host);
  } catch {
    return false;
  }
}

/** Frame one message the way Chrome expects to read it. */
export function encodeMessage(value) {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}

/**
 * Incremental frame reader.
 *
 * A single `data` event is not a message: stdio is a byte stream, so a read can end mid-header,
 * mid-payload, or contain several messages at once. The buffer is kept across reads and the
 * consumer is only handed frames that are whole. Exercised by a spec that feeds one frame in
 * one-byte chunks.
 */
export function createFrameReader() {
  let buffered = Buffer.alloc(0);

  return {
    push(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const messages = [];
      for (;;) {
        if (buffered.length < 4) break;
        const length = buffered.readUInt32LE(0);
        if (buffered.length < 4 + length) break;
        const payload = buffered.subarray(4, 4 + length);
        buffered = buffered.subarray(4 + length);
        messages.push(JSON.parse(payload.toString("utf8")));
      }
      return messages;
    },
  };
}

/**
 * Forward one add body to the core.
 *
 * Every failure returns `success: false` rather than throwing. Chrome treats a crashed host as a
 * disconnect with no reply, which the extension can only report as "host unavailable" — the same
 * message as "host not installed". Distinguishing those two is the whole point of G9.1, so the
 * host must answer even when the core is down.
 */
export async function forwardToCore(body, coreUrl, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!isLoopbackUrl(coreUrl)) {
    return {
      success: false,
      error: `refusing non-loopback core URL: ${coreUrl} (G7.2 — a remote core needs an explicit named confirmation)`,
    };
  }

  const url = `${coreUrl.replace(/\/+$/, "")}/memory/add`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    try {
      // A 2xx is not a delivery (docs/PROTOCOL.md §2). The core's own verdict is passed through
      // untouched so `interpretAcknowledgement` remains the single judge of acknowledgement.
      return JSON.parse(text);
    } catch {
      return {
        success: false,
        error: `core replied with a body that is not JSON (HTTP ${response.status})`,
      };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { success: false, error: `core not reachable at ${coreUrl}: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one request that is not a capture.
 *
 * Without it a registered host and a running core are indistinguishable: `connectNative` succeeds
 * whenever the host is installed, and the extension would report the connection healthy while the
 * core was down — or report it down while everything was in fact installed. The probe is
 * deliberately side-effect free (`GET /health`), because a health check that writes a record is a
 * health check nobody can run.
 */
export const HEALTH_REQUEST_TYPE = "health";

/** True when a message is the health probe rather than a capture body. */
export function isHealthRequest(body) {
  return typeof body === "object" && body !== null && body.type === HEALTH_REQUEST_TYPE;
}

/**
 * The `type` of a control message this host does not implement, or `null` for a capture body.
 *
 * A capture body is exactly `toAddBody(record)` in `src/api/transport/endpoints.ts`, which emits
 * `actor`, `action`, `target`, `metadata` and an optional handful of others — it never emits `type`.
 * So the presence of a string `type` is what distinguishes a control message from a capture, and an
 * unrecognised one is this host's gap, not the core's.
 *
 * That distinction was added after a live run: an unknown type was forwarded to `POST /memory/add`,
 * the core answered `422`, and the host reported `"core replied with a body that is not JSON (HTTP
 * 422)"`. Nothing was written, so the behaviour was safe — but the message blamed the core for a
 * request this host should never have sent, and the next person to read it would have started
 * looking in the wrong repository. A wrong diagnosis is worse than a missing one when the two
 * systems are in separate codebases.
 */
export function unknownControlType(body) {
  if (typeof body !== "object" || body === null) return null;
  return typeof body.type === "string" ? body.type : null;
}

/**
 * Ask the core whether it is up, without writing anything.
 *
 * Answers with the same `{success, ...}` shape as a capture so one reply parser handles both, and
 * reports the core's own status text rather than a bare boolean — the difference between
 * "connection refused" and "HTTP 500" is the difference between two very different next actions.
 */
export async function probeCore(coreUrl, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!isLoopbackUrl(coreUrl)) {
    return {
      success: false,
      healthy: false,
      core_url: coreUrl,
      detail: `refusing non-loopback core URL: ${coreUrl} (G7.2 — a remote core needs an explicit named confirmation)`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${coreUrl.replace(/\/+$/, "")}/health`, { signal: controller.signal });
    return {
      success: true,
      healthy: response.ok,
      core_url: coreUrl,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      healthy: false,
      core_url: coreUrl,
      detail: `core not reachable at ${coreUrl}: ${reason}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handle one request and write exactly one framed reply.
 *
 * Kept separate from `main()` so the request/reply pairing can be driven without a process.
 *
 * Three outcomes, in this order: a health probe is answered locally, an unrecognised control message
 * is refused locally, and only a capture body is forwarded. The order matters — the refusals must
 * happen before the network, so a malformed message can never become a write.
 */
export async function handleRequest(body, coreUrl, write) {
  if (isHealthRequest(body)) {
    write(encodeMessage(await probeCore(coreUrl)));
    return;
  }

  const unknownType = unknownControlType(body);
  if (unknownType !== null) {
    write(
      encodeMessage({
        success: false,
        error:
          `unknown request type "${unknownType}". This host understands a capture body ` +
          `(actor, action, target) and {"type":"health"}. Nothing was sent to the core.`,
      }),
    );
    return;
  }

  write(encodeMessage(await forwardToCore(body, coreUrl)));
}

async function main() {
  const coreUrl = resolveCoreUrl(process.env);
  const reader = createFrameReader();

  // Replies are serialised through one promise chain. Chrome expects one reply per request on the
  // same port; two concurrent `stdout.write` calls would interleave their frames and desynchronise
  // the stream, which Chrome reports as a malformed message.
  let queue = Promise.resolve();

  process.stdin.on("data", (chunk) => {
    let messages;
    try {
      messages = reader.push(chunk);
    } catch (error) {
      process.stderr.write(`bridge-host: malformed frame: ${String(error)}\n`);
      process.exit(1);
    }

    for (const message of messages) {
      queue = queue.then(() => handleRequest(message, coreUrl, (frame) => process.stdout.write(frame)));
    }
  });

  // Chrome closes stdin when the extension disconnects. Exiting here is what stops an orphaned
  // host process accumulating after every service-worker restart.
  process.stdin.on("end", () => process.exit(0));
}

/**
 * Only run when executed, never when imported.
 *
 * `pathToFileURL` rather than string concatenation: on Windows `process.argv[1]` is a backslash
 * path, and `file://C:\...` is not a valid URL, so a concatenated comparison silently reports
 * "not invoked directly" and the host exits without reading a single message.
 */
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void main();
}
