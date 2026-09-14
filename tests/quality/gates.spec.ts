/**
 * Gate-configuration specs (tasks 9.6, 9.7, 9.11, 9.13; G6.1, G6.2, G6.3, G6.6, G6.7).
 *
 * These are the gates' own invariants. A gate that silently stops covering what it claims is worse
 * than no gate, because it is reported as evidence. Four properties are asserted here:
 *
 * 1. no committed spec is focused or skipped, so `npm test` cannot report a green suite that
 *    executed half of itself (`only`) or none of it (`skip`);
 * 2. the typecheck gate's strictness cannot be weakened without failing a test;
 * 3. the build output is ignored and nothing from it is tracked;
 * 4. one command runs the gates in a fixed order.
 *
 * None of these run the tools. They read the configuration the tools obey, because the tools
 * themselves are already executed by the gate chain and their output is recorded in `tasks.md`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, findViolations, scanTree } from "../helpers/scan.js";

const TESTS_DIR = path.join(REPO_ROOT, "tests");

const readConfig = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, file), "utf8")) as Record<string, unknown>;

const scripts = (): Record<string, string> =>
  (readConfig("package.json") as { scripts?: Record<string, string> }).scripts ?? {};

interface TsConfig {
  compilerOptions?: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
  extends?: string;
}

const tsconfig = (file: string): TsConfig => readConfig(file) as TsConfig;

describe("the test gate cannot run a subset and call it green — G6.3 (task 9.6)", () => {
  // The patterns are assembled from fragments on purpose: a spec that contains the literal it
  // forbids would fail its own scan, which is a trap this repository has already been bitten by
  // with a forbidden endpoint path.
  const FOCUSED = new RegExp(`\\b(it|describe|test|suite)\\.${"on" + "ly"}\\b`);
  const SKIPPED = new RegExp(`\\b(it|describe|test|suite)\\.${"sk" + "ip"}\\b`);
  const PLACEHOLDER = new RegExp(`\\b(it|describe|test|suite)\\.${"to" + "do"}\\b`);

  const specs = scanTree(TESTS_DIR).filter((file) => /\.spec\.ts$/.test(file.path));

  it("finds the specs it asserts over", () => {
    expect(specs.length).toBeGreaterThanOrEqual(30);
  });

  it("commits no focused case", () => {
    expect(findViolations(specs, FOCUSED)).toEqual([]);
  });

  it("commits no skipped case", () => {
    expect(findViolations(specs, SKIPPED)).toEqual([]);
  });

  it("commits no placeholder case, which would be a claim with nothing behind it", () => {
    expect(findViolations(specs, PLACEHOLDER)).toEqual([]);
  });

  it("would notice a focused case if one were present, so the checks are not vacuous", () => {
    const synthetic = [
      { path: "tests/synthetic.spec.ts", content: `it.${"on" + "ly"}("x", () => {});\n` },
    ];
    expect(findViolations(synthetic, FOCUSED)).toHaveLength(1);
    expect(findViolations(synthetic, SKIPPED)).toEqual([]);
  });
});

describe("the typecheck gate keeps its strictness — G6.1 (task 9.7)", () => {
  const base = tsconfig("tsconfig.json");

  it("compiles the whole production tree with strict on", () => {
    expect(base.compilerOptions?.strict).toBe(true);
    expect(base.include).toContain("src/**/*");
    expect(base.compilerOptions?.noEmit).toBeUndefined();
  });

  it("has not switched off any flag that strict turns on", () => {
    const strictlyImplied = [
      "noImplicitAny",
      "strictNullChecks",
      "strictFunctionTypes",
      "strictBindCallApply",
      "strictPropertyInitialization",
      "noImplicitThis",
      "alwaysStrict",
      "useUnknownInCatchVariables",
    ];

    const weakened = strictlyImplied.filter((flag) => base.compilerOptions?.[flag] === false);
    expect(weakened).toEqual([]);
  });

  it("has not re-enables an option that suppresses implicit-any reporting", () => {
    expect(base.compilerOptions?.suppressImplicitAnyIndexErrors).toBeUndefined();
    expect(base.compilerOptions?.noStrictGenericChecks).toBeUndefined();
  });

  it("would notice a weakened config, so the check above is not vacuous", () => {
    const weakened: TsConfig = { compilerOptions: { strict: true, strictNullChecks: false } };
    const flags = Object.entries(weakened.compilerOptions ?? {})
      .filter(([, value]) => value === false)
      .map(([key]) => key);
    expect(flags).toEqual(["strictNullChecks"]);
  });

  it("type-checks the tests with the same strictness", () => {
    const test = tsconfig("tsconfig.test.json");
    expect(test.extends).toBe("./tsconfig.json");
    expect(test.compilerOptions?.noEmit).toBe(true);
    expect(test.include).toContain("tests/**/*");
    expect(scripts().typecheck).toContain("tsconfig.test.json");
  });
});

describe("the lint gate is a real flat config — G6.2", () => {
  const configText = readFileSync(path.join(REPO_ROOT, "eslint.config.js"), "utf8");

  it("lints both the sources and the specs", () => {
    expect(scripts().lint).toBe("eslint src tests");
    expect(existsSync(path.join(REPO_ROOT, "eslint.config.js"))).toBe(true);
  });

  it("is a flat config that ignores the build output", () => {
    expect(configText).toMatch(/export default/);
    expect(configText).toMatch(/ignores:\s*\[[^\]]*"dist\/\*\*"/);
    expect(configText).toMatch(/files:\s*\[/);
  });

  it("applies a recommended rule set and defines a rule this repository needs", () => {
    expect(configText).toContain("tseslint.configs.recommended");
    expect(configText).toContain("@typescript-eslint/no-unused-vars");
  });
});

describe("the build output is ignored and untracked — G6.7 (task 9.11)", () => {
  const ignoreText = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");

  it("ignores the build output directory", () => {
    const lines = ignoreText.split(/\r?\n/).map((line) => line.trim());
    expect(lines).toContain("dist/");
  });

  it("tracks no file inside the build output directory", () => {
    const tracked = execFileSync("git", ["ls-files", "dist"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    expect(tracked).toBe("");
  });
});

describe("cross-platform scripts — G6.6", () => {
  it("runs clean and package through Node rather than a POSIX shell", () => {
    expect(scripts().clean).toBe("node scripts/clean.js");
    expect(scripts().package).toContain("node scripts/package.js");
    expect(`${scripts().clean} ${scripts().package}`).not.toMatch(/rm -rf|cd dist && zip/);
  });
});

describe("one command runs every gate — task 9.13", () => {
  const chain = scripts().verify ?? "";
  const steps = chain.split("&&").map((step) => step.trim());

  it("runs the four gates in order, as a single command", () => {
    expect(steps).toEqual([
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run build",
    ]);
  });

  it("names only scripts that exist, so a typo cannot silently skip a gate", () => {
    const named = steps.map((step) => step.replace(/^npm (run )?/, ""));
    expect(named.length).toBeGreaterThan(0);
    expect(named).toEqual(["typecheck", "lint", "test", "build"]);

    const unknown = named.filter((name) => !(name in scripts()));
    expect(unknown).toEqual([]);
  });

  it("stops at the first failing gate rather than reporting a later one", () => {
    // The stop-on-failure property is the shell's `&&`, and the gates are chained with it. The
    // chain is run by hand and its output recorded in tasks.md; asserting the operator here keeps
    // a future edit from replacing it with `;`, which would run every gate regardless.
    expect(chain).toContain("&&");
    expect(chain).not.toMatch(/;\s*npm run/);
  });

  it("is not reachable from the test gate, so the chain cannot recurse", () => {
    expect(scripts().test).toBe("vitest run");
    expect(scripts().test).not.toContain("verify");
    expect(scripts().package).not.toContain("verify");
  });

  it("exposes the traceability gate as its own command — G6.8", () => {
    expect(scripts()["test:traceability"]).toBe("node scripts/traceability.js");
  });
});
