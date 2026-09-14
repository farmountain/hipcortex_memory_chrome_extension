/**
 * Traceability-gate specs (task 9.14, G6.8).
 *
 * The gate itself is `scripts/traceability.js`. This spec proves two things a gate must be able to
 * show about itself:
 *
 * 1. **It can fail.** Every one of the three conditions is exercised against a synthetic input, so
 *    a green run means "no unresolved claim", not "the detector never fires".
 * 2. **It is green on this repository.** The last case runs the real check over the real plan files.
 *
 * The parsers are asserted separately because they decide what counts as a citation. If
 * `parseRequirementCitations` silently accepted scenarios, a criterion could lose its requirement
 * anchor while the gate stayed green — the failure would be in the parser, not in the plan.
 */

import { describe, expect, it } from "vitest";

import path from "node:path";

import { REPO_ROOT } from "../helpers/scan.js";
import {
  audit,
  checkTraceability,
  idsIn,
  parseCriteria,
  parseRequirementCitations,
  parseTestPathCitations,
  planFiles,
  type PlanSource,
} from "../../scripts/traceability.js";

const END_STATE_SAMPLE = [
  "| ID | Criterion | Verification |",
  "|----|-----------|--------------|",
  "| G1.1 | Each provider has an adapter | `npm test -- tests/capture/providers/registry.spec.ts` |",
  "| G1.2 | `matches()` returns true for the canonical URL | `npm test -- tests/capture/providers` |",
  "",
  "Prose that mentions G9.9 without declaring it.",
].join("\n");

describe("citation parsing decides what is anchored", () => {
  it("finds every criterion id in a line", () => {
    expect(idsIn("### Requirement: Queue (G2.1, G2.2)")).toEqual(["G2.1", "G2.2"]);
    expect(idsIn("no ids here")).toEqual([]);
  });

  it("reads declarations from the acceptance-criteria tables only", () => {
    const criteria = parseCriteria(END_STATE_SAMPLE);
    expect([...criteria.keys()]).toEqual(["G1.1", "G1.2"]);
    expect(criteria.get("G1.1")?.line).toBe(3);
    expect(criteria.has("G9.9")).toBe(false);
  });

  it("counts a criterion once even if a table repeats it", () => {
    const repeated = `${END_STATE_SAMPLE}\n| G1.1 | repeated row | x |\n`;
    expect([...parseCriteria(repeated).keys()]).toEqual(["G1.1", "G1.2"]);
  });

  it("takes citations from requirement headings", () => {
    const sources: PlanSource[] = [
      {
        path: "openspec/changes/example/specs/demo/spec.md",
        content: [
          "## ADDED Requirements",
          "",
          "### Requirement: Delivery is acknowledged (G2.1)",
          "",
          "#### Scenario: A bare 2xx is not an acknowledgement (G2.9)",
          "- **THEN** it is retained",
        ].join("\n"),
      },
    ];

    const citations = parseRequirementCitations(sources);
    expect(citations).toEqual([
      {
        id: "G2.1",
        path: "openspec/changes/example/specs/demo/spec.md",
        line: 3,
        heading: "### Requirement: Delivery is acknowledged (G2.1)",
      },
    ]);
  });

  it("ignores a criterion id that appears only in a scenario", () => {
    const sources: PlanSource[] = [
      {
        path: "openspec/changes/example/specs/demo/spec.md",
        content: "#### Scenario: something (G2.9)\n- **THEN** nothing\n",
      },
    ];
    expect(parseRequirementCitations(sources)).toEqual([]);
  });

  it("reads backticked test paths and treats a directory as a citation", () => {
    const sources: PlanSource[] = [
      {
        path: "openspec/changes/example/tasks.md",
        content: [
          "- [ ] 1.1 Add a spec. Test: `tests/quality/manifest.spec.ts`",
          "- [ ] 1.2 Cover the providers. Test: `tests/capture/providers/`",
          "- [ ] 1.3 Not a citation: tests/quality/readme.spec.ts",
        ].join("\n"),
      },
    ];

    const citations = parseTestPathCitations(sources);
    expect(citations.map((citation) => citation.path)).toEqual([
      "tests/quality/manifest.spec.ts",
      "tests/capture/providers",
    ]);
    expect(citations.map((citation) => citation.line)).toEqual([1, 2]);
  });

  it("reads a path from inside a backticked command, which is how the criteria table states it", () => {
    // The acceptance-criteria table writes its verification as a whole command, so anchoring the
    // path to the opening backtick would read nothing from it. A reader must be able to copy the
    // cell and run it, so the path is what is checked and the command around it is not.
    const sources: PlanSource[] = [
      {
        path: "docs/END-STATE.md",
        content:
          "| G3.9 | search with the runtime stopped | `npm test -- tests/index/offline-search.spec.ts` |\n",
      },
    ];

    expect(parseTestPathCitations(sources)).toEqual([
      {
        raw: "tests/index/offline-search.spec.ts",
        path: "tests/index/offline-search.spec.ts",
        filePath: "docs/END-STATE.md",
        line: 1,
      },
    ]);
  });
});

describe("the gate is able to fail (task 9.14)", () => {
  const criteria = parseCriteria(END_STATE_SAMPLE);
  const cites = (id: string) => ({
    id,
    path: "openspec/changes/example/specs/demo/spec.md",
    line: 3,
    heading: `### Requirement: something (${id})`,
  });

  it("passes when every criterion is cited and every test path exists", () => {
    const report = audit({
      criteria,
      requirementCitations: [cites("G1.1"), cites("G1.2")],
      testCitations: [
        { raw: "tests/a.spec.ts", path: "tests/a.spec.ts", filePath: "tasks.md", line: 1 },
      ],
      exists: () => true,
    });

    expect(report.failures).toEqual([]);
    expect(report.criteria).toBe(2);
    expect(report.criteriaCited).toBe(2);
    expect(report.testCitations).toBe(1);
  });

  it("fails on a criterion that no requirement heading cites", () => {
    const report = audit({
      criteria,
      requirementCitations: [cites("G1.1")],
      testCitations: [],
      exists: () => true,
    });

    expect(report.failures).toEqual(["criterion G1.2 is cited by no requirement heading"]);
    expect(report.criteriaCited).toBe(1);
  });

  it("fails on a citation of a criterion that is not declared", () => {
    const report = audit({
      criteria,
      requirementCitations: [cites("G1.1"), cites("G1.2"), cites("G9.9")],
      testCitations: [],
      exists: () => true,
    });

    expect(report.failures).toEqual([
      "openspec/changes/example/specs/demo/spec.md:3 cites G9.9, which docs/END-STATE.md does not define",
    ]);
  });

  it("fails on a cited test path that does not exist", () => {
    const report = audit({
      criteria,
      requirementCitations: [cites("G1.1"), cites("G1.2")],
      testCitations: [
        { raw: "tests/ghost.spec.ts", path: "tests/ghost.spec.ts", filePath: "tasks.md", line: 7 },
      ],
      exists: () => false,
    });

    expect(report.failures).toEqual([
      "tasks.md:7 cites tests/ghost.spec.ts, which does not exist",
    ]);
  });

  it("reports one failure per claim, not one per repetition of it", () => {
    const citation = {
      raw: "tests/ghost.spec.ts",
      path: "tests/ghost.spec.ts",
      filePath: "tasks.md",
      line: 7,
    };

    const report = audit({
      criteria,
      requirementCitations: [cites("G1.1"), cites("G1.2")],
      testCitations: [citation, citation],
      exists: () => false,
    });

    expect(report.failures).toHaveLength(1);
  });

  it("can report all three conditions at once", () => {
    const report = audit({
      criteria,
      requirementCitations: [cites("G9.9")],
      testCitations: [
        { raw: "tests/ghost.spec.ts", path: "tests/ghost.spec.ts", filePath: "tasks.md", line: 9 },
      ],
      exists: () => false,
    });

    expect(report.failures).toHaveLength(4);
  });
});

describe("the plan files this gate reads", () => {
  it("finds the end-state document, the capability specs and the change's tasks", () => {
    const files = planFiles(REPO_ROOT);

    expect(files.endState).toBe(path.join(REPO_ROOT, "docs", "END-STATE.md"));
    expect(files.specs.length).toBeGreaterThanOrEqual(6);
    expect(files.specs.every((file) => file.endsWith("spec.md"))).toBe(true);
    expect(files.tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns an empty plan rather than throwing when there is no change directory", () => {
    const files = planFiles(path.join(REPO_ROOT, "does-not-exist"));
    expect(files.specs).toEqual([]);
    expect(files.tasks).toEqual([]);
  });
});

describe("this repository's plan is fully anchored — G6.8", () => {
  it("reports no unresolved claim", () => {
    const report = checkTraceability(REPO_ROOT);

    expect(report.failures).toEqual([]);
    expect(report.criteria).toBeGreaterThanOrEqual(60);
    expect(report.criteriaCited).toBe(report.criteria);
    expect(report.testCitations).toBeGreaterThan(0);
  });

  it("checks the criteria table's own verification column, not only the tasks files", () => {
    // The rule used to read `tasks.md` alone, which left the one column that says *how* a criterion
    // is proved unverified. The table cited `tests/index/search-offline.spec.ts` (the words
    // transposed) and `tests/capture/pipeline` (no extension) — neither on disk — and stayed green.
    const report = checkTraceability(REPO_ROOT);

    expect(report.testCitationFiles).toContain("docs/END-STATE.md");
    expect(report.testCitationFiles.some((file) => file.endsWith("tasks.md"))).toBe(true);
  });
});
