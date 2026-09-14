/**
 * Clarity-protocol specs (change `clarity-protocol`, CP1-CP9).
 *
 * `docs/CLARITY.md` states the rules; `docs/clarity-ledger.json` is the record; `scripts/clarity.js`
 * is the gate that reads it. A process gate is only worth having if it can fail, so the bulk of this
 * spec is a table of deliberately bad ledgers, each of which must trip a named rule. The audit is
 * imported in-process rather than spawned per case, because a rule that can only be checked by
 * starting a Node process is a rule nobody will re-check.
 *
 * Three things are also checked that are not about the ledger's content: that the gate is exposed as
 * its own command and deliberately not folded into `npm run verify` (CP9 - the chain is pinned to
 * four gate commands by `tests/quality/gates.spec.ts`, and loosening that to add a document would be
 * the trade this protocol exists to refuse); that the real ledger passes; and that nothing under
 * `src/` knows this mechanism exists (CP8 - the extension perceives, it does not reason about its own
 * uncertainty).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { REPO_ROOT, findViolations, scanTree } from "../helpers/scan.js";
import { auditLedger, checkLedger } from "../../scripts/clarity.js";

interface LedgerQuestion {
  id?: string;
  stage?: string;
  critical?: boolean;
  question?: string;
  state?: string;
  attempts?: number;
  artifactsTried?: string[];
  evidence?: string[];
  doesNotEstablish?: string;
  resolution?: string;
  reason?: string;
  exitCondition?: string;
  escalation?: { question?: string; whyArtifactsFailed?: string; decidedBy?: string };
  reopens?: string[];
  newEvidence?: string[];
  escalations?: number;
}

interface Ledger {
  version?: number;
  policy?: {
    maxSelfPromptAttempts?: number;
    maxEscalationsPerQuestion?: number;
    reopenRequiresNewEvidence?: boolean;
  };
  stages?: { stage?: string; entries?: string[] }[];
  questions?: LedgerQuestion[];
}

/** A ledger that satisfies every rule, so each case below changes exactly one thing. */
const validLedger = (): Ledger => ({
  version: 1,
  policy: {
    maxSelfPromptAttempts: 5,
    maxEscalationsPerQuestion: 1,
    reopenRequiresNewEvidence: true,
  },
  stages: [
    { stage: "goals", entries: ["Q1"] },
    { stage: "acceptance-criteria", entries: [] },
    { stage: "validation-planning", entries: [] },
    { stage: "unknowns", entries: [] },
    { stage: "planning", entries: [] },
    { stage: "react-iterations", entries: [] },
  ],
  questions: [
    {
      id: "Q1",
      stage: "goals",
      critical: true,
      question: "Can the goal be falsified?",
      state: "self-resolved",
      attempts: 1,
      artifactsTried: ["docs/CLARITY.md - read the resolution order"],
      evidence: ["$ node scripts/clarity.js -> exit 0"],
      doesNotEstablish: "Nothing about the shipped extension.",
      resolution: "Read the artifact and wrote down what it does not settle.",
    },
  ],
});

const withLedger = (mutate: (ledger: Ledger) => void): Ledger => {
  const ledger = validLedger();
  mutate(ledger);
  return ledger;
};

const failureText = (ledger: unknown): string => auditLedger(ledger).failures.join("\n");

describe("the ledger audit accepts a well-formed ledger - CP2, CP3", () => {
  it("passes the valid fixture, so the cases below are not vacuous", () => {
    expect(auditLedger(validLedger()).failures).toEqual([]);
  });

  it("reports the questions, their states and their stage coverage", () => {
    const report = auditLedger(validLedger());
    expect(report.questions).toBe(1);
    expect(report.byState).toEqual({ "self-resolved": 1 });
    expect(report.coverage.goals).toBe(1);
  });
});

describe("a question without a state, or with a state that is not one of the four - CP2", () => {
  const cases: Array<[string, (ledger: Ledger) => void, string]> = [
    [
      "no state at all",
      (ledger) => {
        delete ledger.questions![0].state;
      },
      "which is not one of",
    ],
    ["a placeholder state", (ledger) => (ledger.questions![0].state = "tbd"), "which is not one of"],
  ];

  it.each(cases)("rejects a question with %s", (_name, mutate, fragment) => {
    expect(failureText(withLedger(mutate))).toContain(fragment);
  });
});

describe("a self-resolution has to be reducible to something re-runnable - CP3, CP4", () => {
  const cases: Array<[string, (ledger: Ledger) => void, string]> = [
    ["no evidence", (ledger) => (ledger.questions![0].evidence = []), "self-resolved with no evidence"],
    [
      "prose for evidence",
      (ledger) => (ledger.questions![0].evidence = ["we thought about it and it seemed fine"]),
      "not a command, a file or a probe",
    ],
    [
      "no statement of what the evidence fails to establish",
      (ledger) => {
        delete ledger.questions![0].doesNotEstablish;
      },
      "does not state what its evidence fails to establish",
    ],
    [
      "no resolution",
      (ledger) => {
        delete ledger.questions![0].resolution;
      },
      "self-resolved with no resolution",
    ],
    [
      "no record of what was tried",
      (ledger) => (ledger.questions![0].artifactsTried = []),
      "records no artifacts tried",
    ],
  ];

  it.each(cases)("rejects a self-resolved question with %s", (_name, mutate, fragment) => {
    expect(failureText(withLedger(mutate))).toContain(fragment);
  });
});

describe("escalation is critical-only and has to say why the artifacts failed - CP1, CP6", () => {
  const cases: Array<[string, (ledger: Ledger) => void, string]> = [
    [
      "a non-critical escalation",
      (ledger) => {
        const question = ledger.questions![0];
        question.state = "escalated";
        question.critical = false;
        question.escalation = { question: "Ask?", whyArtifactsFailed: "no artifact", decidedBy: "user" };
      },
      "escalated without being critical",
    ],
    [
      "no record of why the artifacts failed",
      (ledger) => {
        const question = ledger.questions![0];
        question.state = "escalated";
        question.escalation = { question: "Ask?", decidedBy: "user" };
      },
      "why the artifacts did not reach it",
    ],
    [
      "nobody named to answer it",
      (ledger) => {
        const question = ledger.questions![0];
        question.state = "escalated";
        question.escalation = { question: "Ask?", whyArtifactsFailed: "no artifact" };
      },
      "no one to answer it",
    ],
    [
      "more escalation rounds than the policy allows",
      (ledger) => {
        const question = ledger.questions![0];
        question.state = "escalated";
        question.escalations = 2;
        question.escalation = { question: "Ask?", whyArtifactsFailed: "no artifact", decidedBy: "user" };
      },
      "over the policy limit",
    ],
  ];

  it.each(cases)("rejects escalation with %s", (_name, mutate, fragment) => {
    expect(failureText(withLedger(mutate))).toContain(fragment);
  });
});

describe("an open question without a real exit never closes - CP5", () => {
  const cases: Array<[string, (ledger: Ledger) => void, string]> = [
    [
      "no exit condition",
      (ledger) => (ledger.questions![0].state = "open-with-exit"),
      "open with no exit condition",
    ],
    [
      "an exit condition of TBD",
      (ledger) => {
        ledger.questions![0].state = "open-with-exit";
        ledger.questions![0].exitCondition = "TBD";
      },
      "names nothing",
    ],
    [
      "an exit condition that is a promise, not a check",
      (ledger) => {
        ledger.questions![0].state = "open-with-exit";
        ledger.questions![0].exitCondition = "at some point someone will deal with it";
      },
      "names nothing",
    ],
    [
      "an exit condition naming no owner",
      (ledger) => {
        ledger.questions![0].state = "open-with-exit";
        ledger.questions![0].exitCondition = "it closes when the behaviour is different";
      },
      "names no change, section, gate, probe or actor",
    ],
  ];

  it.each(cases)("rejects an open question with %s", (_name, mutate, fragment) => {
    expect(failureText(withLedger(mutate))).toContain(fragment);
  });

  it("accepts a withdrawn question that states why it dissolved", () => {
    const withdrawn = withLedger((ledger) => {
      ledger.questions![0].state = "withdrawn";
      ledger.questions![0].reason = "the command cannot be read at that size and the file is authoritative";
    });
    expect(auditLedger(withdrawn).failures).toEqual([]);
  });

  it("rejects a withdrawn question with no reason", () => {
    const bad = withLedger((ledger) => (ledger.questions![0].state = "withdrawn"));
    expect(failureText(bad)).toContain("withdrawn with no reason");
  });
});

describe("the attempt budget and the re-open rule bound both loops - CP5", () => {
  const cases: Array<[string, (ledger: Ledger) => void, string]> = [
    ["more self-prompt attempts than the budget", (ledger) => (ledger.questions![0].attempts = 9), "over the budget of 5"],
    ["no attempt count", (ledger) => {
      delete ledger.questions![0].attempts;
    }, "no attempt count"],
    [
      "a raised attempt budget",
      (ledger) => (ledger.policy!.maxSelfPromptAttempts = 9),
      "may not be raised here",
    ],
    [
      "more than one escalation round allowed",
      (ledger) => (ledger.policy!.maxEscalationsPerQuestion = 3),
      "must be 0 or 1",
    ],
    [
      "re-opening without new evidence",
      (ledger) => (ledger.questions![0].reopens = ["Q1"]),
      "re-opened without naming new evidence",
    ],
  ];

  it.each(cases)("rejects %s", (_name, mutate, fragment) => {
    expect(failureText(withLedger(mutate))).toContain(fragment);
  });
});

describe("identity, ordering and stage coverage are structural - CP7", () => {
  const cases: Array<[string, (ledger: Ledger) => void, string]> = [
    [
      "an id that is not Q<number>",
      (ledger) => (ledger.questions![0].id = "X1"),
      "does not match Q<number>",
    ],
    [
      "a repeated id",
      (ledger) => ledger.questions!.push({ ...ledger.questions![0] }),
      "appears twice",
    ],
    [
      "ids out of order",
      (ledger) => {
        ledger.questions![0].id = "Q3";
        ledger.questions!.push({ ...ledger.questions![0], id: "Q2" });
        ledger.stages![0].entries = ["Q3", "Q2"];
      },
      "breaks the ascending id order",
    ],
    ["no question text", (ledger) => {
      delete ledger.questions![0].question;
    }, "has no question text"],
    ["no criticality", (ledger) => {
      delete ledger.questions![0].critical;
    }, "does not say whether it is critical"],
    [
      "an unknown stage on the question",
      (ledger) => (ledger.questions![0].stage = "vibes"),
      "which is not a stage the protocol defines",
    ],
    [
      "a missing stage",
      (ledger) => (ledger.stages = ledger.stages!.filter((stage) => stage.stage !== "planning")),
      "stage planning is missing",
    ],
    [
      "an unknown stage in the list",
      (ledger) => ledger.stages!.push({ stage: "extra", entries: [] }),
      "is not a stage the protocol defines",
    ],
    [
      "a question in no stage",
      (ledger) => (ledger.stages![0].entries = []),
      "belongs to no stage",
    ],
    [
      "a question in two stages",
      (ledger) => (ledger.stages![5].entries = ["Q1"]),
      "belongs to 2 stages",
    ],
    [
      "a stage naming a question that is not in the ledger",
      (ledger) => (ledger.stages![0].entries = ["Q1", "Q9"]),
      "is not a question in the ledger",
    ],
    [
      "a stage that disagrees with the question",
      (ledger) => {
        ledger.stages![0].entries = [];
        ledger.stages![4].entries = ["Q1"];
      },
      "but is listed under planning",
    ],
    ["no questions at all", (ledger) => (ledger.questions = []), "records no questions"],
  ];

  it.each(cases)("rejects %s", (_name, mutate, fragment) => {
    expect(failureText(withLedger(mutate))).toContain(fragment);
  });
});

describe("a ledger that is not a ledger at all", () => {
  it("rejects a top-level array, so an empty file cannot pass by accident", () => {
    expect(failureText([])).toContain("must be a JSON object");
  });

  it("rejects a missing version", () => {
    const bad = withLedger((ledger) => {
      delete ledger.version;
    });
    expect(failureText(bad)).toContain("expected 1");
  });
});

describe("the gate itself - CP9", () => {
  const cli = (args: string[]): { status: number; stdout: string } => {
    try {
      const stdout = execFileSync("node", ["scripts/clarity.js", ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      return { status: 0, stdout };
    } catch (error) {
      const failure = error as { status?: number | null; stdout?: string };
      return { status: failure.status ?? -1, stdout: failure.stdout ?? "" };
    }
  };

  const scripts = (): Record<string, string> => {
    const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    return manifest.scripts ?? {};
  };

  it("passes on the committed ledger and reports the counts", () => {
    const result = cli([]);
    expect(result.stdout).toContain("OK - every question has a state");
    expect(result.status).toBe(0);
  });

  it("fails the process on a bad ledger, so a drifted ledger cannot pass unnoticed", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "clarity-bad-"));
    const file = path.join(dir, "ledger.json");
    writeFileSync(file, JSON.stringify(withLedger((ledger) => (ledger.questions![0].state = "tbd"))));
    const result = cli([file]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails the process when the ledger is not parseable", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "clarity-json-"));
    const file = path.join(dir, "ledger.json");
    writeFileSync(file, "{ not json");
    expect(checkLedger(file).failures.join(" ")).toContain("not valid JSON");
    expect(cli([file]).status).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails the process when the named ledger does not exist", () => {
    expect(checkLedger(path.join(REPO_ROOT, "docs", "no-such-ledger.json")).failures.join(" ")).toContain(
      "no ledger at",
    );
  });

  it("is exposed as its own command and is not hidden inside npm run verify", () => {
    expect(scripts()["test:clarity"]).toBe("node scripts/clarity.js");
    expect(scripts().verify ?? "").not.toContain("clarity");
    expect((scripts().verify ?? "").split("&&").map((step) => step.trim())).toEqual([
      "npm run typecheck",
      "npm run lint",
      "npm test",
      "npm run build",
    ]);
  });

  it("reads the ledger the protocol document names", () => {
    const protocol = readFileSync(path.join(REPO_ROOT, "docs", "CLARITY.md"), "utf8");
    expect(protocol).toContain("docs/clarity-ledger.json");
    expect(protocol).toContain("npm run test:clarity");
  });
});

describe("the mechanism is process, not product - CP8", () => {
  it("is mentioned nowhere under src/, so no cognition enters the perception layer", () => {
    const forbidden = /clarity-ledger|CLARITY\.md|clarity-protocol/i;
    const sources = scanTree(path.join(REPO_ROOT, "src")).filter((file) => /\.(ts|js)$/.test(file.path));
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(findViolations(sources, forbidden)).toEqual([]);
  });

  it("would notice the reference if one were added, so the scan is not vacuous", () => {
    const synthetic = [{ path: "src/synthetic.ts", content: "// see docs/CLARITY.md\n" }];
    expect(findViolations(synthetic, /clarity-ledger|CLARITY\.md|clarity-protocol/i)).toHaveLength(1);
  });
});
