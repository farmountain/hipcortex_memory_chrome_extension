import { defineWorkspace } from "vitest/config";

/**
 * Two projects, one per execution environment (task 1.2).
 *
 * Vitest 2.x expresses multi-environment runs through a workspace file; `test.projects` only
 * exists from Vitest 3. This repository pins Vitest 2.1.9, so the workspace form is the correct
 * one here — upgrading Vitest purely to move this declaration into `vitest.config.ts` would be
 * churn with no behavioural gain.
 *
 * The split is by path and the two `include` sets are exact complements, so a spec can never run
 * twice or in the wrong environment:
 *   - `jsdom` — specs that need a DOM: provider adapters, the capture pipeline, the extension
 *               surfaces and the options page.
 *   - `node`  — everything else: schema, transport, quality scans, migration.
 *
 * `passWithNoTests: false` is set on both. A project that silently passes because it matched no
 * files is exactly the failure mode the quality gates exist to catch (`docs/END-STATE.md` G6.3),
 * so an empty project must fail loudly instead.
 */
const DOM_SPECS = [
  "tests/capture/**/*.spec.ts",
  "tests/surfaces/**/*.spec.ts",
  "tests/options/**/*.spec.ts",
];

const NEVER = ["**/node_modules/**", "dist/**", ".scratch/**", "coverage/**"];

export default defineWorkspace([
  {
    test: {
      name: "node",
      environment: "node",
      include: ["tests/**/*.spec.ts"],
      exclude: [...DOM_SPECS, ...NEVER],
      passWithNoTests: false,
    },
  },
  {
    test: {
      name: "jsdom",
      environment: "jsdom",
      include: DOM_SPECS,
      exclude: NEVER,
      passWithNoTests: false,
    },
  },
]);
