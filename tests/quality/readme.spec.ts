import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, findViolations } from "../helpers/scan.js";

/**
 * Tasks 2.7 and 9.12 — the README is a user-facing surface, so the claims it makes are assertions
 * about this repository and are checked like any other assertion.
 *
 * Both cases exist because of specific historical defects: the prerequisites section used to tell
 * Consumer Mode users to install the HipCortex server by hand, and the two transport modes were
 * described as an implementation detail rather than as the choice that decides where captures are
 * allowed to go (`G7`).
 */
const README = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");

describe("README", () => {
  it("is non-trivial", () => {
    expect(README.length).toBeGreaterThan(1000);
  });

  it("never requires a hand-installed service, in either mode", () => {
    expect(findViolations([{ path: "README.md", content: README }], /\bpip\s+install\b/)).toEqual(
      []
    );
  });

  it("names both transport modes as things a user chooses between", () => {
    expect(README).toContain("Consumer Mode");
    expect(README).toContain("Developer Mode");
    expect(README).toMatch(/default/i);
  });

  it("points at the authoritative scope document", () => {
    expect(README).toContain("docs/END-STATE.md");
  });
});
