/**
 * Fixture access for provider adapter specs (task 1.13).
 *
 * Fixtures live at `tests/fixtures/<provider>/<name>.html`. They are *structurally faithful but
 * synthetic*: no contributor to this repository can log into all five providers, so the ladder
 * rungs are exercised against markup that reproduces the shape each rung targets. That makes the
 * extraction logic verifiable and the ladders regression-proof, but it is **not** evidence that a
 * rung matches today's live DOM — see `docs/END-STATE.md` G8 and the manual gates 8.13 / 10.7.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./scan.js";

export const FIXTURES_DIR = path.join(REPO_ROOT, "tests", "fixtures");

export function fixturePath(...segments: string[]): string {
  return path.join(FIXTURES_DIR, ...segments);
}

export function readFixture(...segments: string[]): string {
  const file = fixturePath(...segments);
  if (!existsSync(file)) {
    throw new Error(`Missing fixture: ${path.relative(REPO_ROOT, file)}`);
  }
  return readFileSync(file, "utf8");
}

export function listFixtures(provider: string): string[] {
  const dir = fixturePath(provider);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".html"))
    .sort();
}

/**
 * Parse fixture markup into a document. Requires the jsdom environment.
 *
 * `DOMParser` returns a *detached* document, which is what makes the "extraction mutates nothing"
 * assertion (G1.6) mean something: a serialisation comparison would be vacuous if the adapter were
 * handed the live `document`.
 */
export function parseFixture(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}
