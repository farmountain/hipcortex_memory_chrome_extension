/**
 * Router wiring specs (task 6.18, G6.5).
 *
 * Adding a message means two edits in two files: a union member in `src/types/index.ts` and a
 * matching `case` in the worker's router. Nothing in the type system connects them — the union is
 * only the *shape* of the message the worker receives, and a variant with no case falls into
 * `default:` and is answered with a failure at runtime. The spec therefore reads both files and
 * asserts the correspondence in both directions.
 *
 * The scan is deliberately scoped to the router's own `switch (message.type)`: `src/background.ts`
 * contains other switches over other unions, and a naive `case "…"` scan would report those as
 * stale message types. Behaviour of the two capture handlers is proven in the queue/pipeline specs;
 * what is proven here is that a declared message can never be silently unhandled.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../helpers/scan.js";

const TYPES_PATH = path.join(REPO_ROOT, "src", "types", "index.ts");
const ROUTER_PATH = path.join(REPO_ROOT, "src", "background.ts");

function declaredMessageTypes(): string[] {
  const source = readFileSync(TYPES_PATH, "utf8");
  const unionStart = source.indexOf("export type MessageType");
  if (unionStart < 0) throw new Error("MessageType is not declared in src/types/index.ts");
  const union = source.slice(unionStart);

  const declared: string[] = [];
  for (const match of union.matchAll(/\|\s*\{\s*type:\s*"([A-Z_]+)"/g)) {
    const name = match[1];
    if (name) declared.push(name);
  }
  return declared;
}

/** The body of the router's `switch (message.type)`, up to its `default:` clause. */
function routerSwitchBody(): string {
  const source = readFileSync(ROUTER_PATH, "utf8");
  const switchStart = source.indexOf("switch (message.type)");
  if (switchStart < 0) throw new Error("the router does not switch on message.type");
  const defaultStart = source.indexOf("default:", switchStart);
  if (defaultStart < 0) throw new Error("the router has no default clause");
  return source.slice(switchStart, defaultStart);
}

function routedMessageTypes(): string[] {
  const routed: string[] = [];
  for (const match of routerSwitchBody().matchAll(/case\s+"([A-Z_]+)"\s*:/g)) {
    const name = match[1];
    if (name) routed.push(name);
  }
  return routed;
}

describe("every declared message is routed (G6.5)", () => {
  it("declares message types at all", () => {
    expect(declaredMessageTypes().length).toBeGreaterThan(0);
  });

  it("has a handling case for every message type", () => {
    const missing = declaredMessageTypes().filter((name) => !routedMessageTypes().includes(name));

    expect(missing).toEqual([]);
  });

  it("has no case without a message type", () => {
    const stale = routedMessageTypes().filter((name) => !declaredMessageTypes().includes(name));

    expect(stale).toEqual([]);
  });

  it("handles no message type twice", () => {
    const routed = routedMessageTypes();
    const duplicates = routed.filter((name, index) => routed.indexOf(name) !== index);

    expect(duplicates).toEqual([]);
  });

  it("answers an unknown message type with a failure instead of ignoring it", () => {
    const router = readFileSync(ROUTER_PATH, "utf8");
    const defaultClause = router.slice(router.indexOf("default:", router.indexOf("switch (message.type)")));

    expect(defaultClause).toMatch(/success:\s*false/);
  });

  it("keeps the message channel open for the async handler", () => {
    const router = readFileSync(ROUTER_PATH, "utf8");

    expect(router).toContain("return true; // keep channel open for async");
  });

  it("routes the two capture messages this change adds", () => {
    const routed = routedMessageTypes();

    expect(routed).toContain("CAPTURE_UPDATE");
    expect(routed).toContain("CAPTURE_STATUS");
  });
});
