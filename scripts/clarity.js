/**
 * Clarity gate (change `clarity-protocol`, CP1-CP9).
 *
 * `docs/CLARITY.md` states how a question is resolved (artifacts first, a person last), what a
 * question's states are, and when both loops stop. `docs/clarity-ledger.json` is the record. Neither
 * is a test, so without this script the protocol would be a document that a project can drift away
 * from while every other gate stays green - the failure this repository keeps running into, because
 * its gates read code and this one reads how a claim was reached.
 *
 * This script fails on exactly these conditions:
 *
 *   1. an unknown or missing state, or a state whose required fields are absent;
 *   2. a `self-resolved` entry whose evidence is not reducible to a command, a file or a probe
 *      (prose cannot be re-run, so it cannot be wrong in a way anyone would notice),
 *   3. an `escalated` entry that is not critical, or that does not record why the artifacts failed;
 *   4. an `open-with-exit` entry whose exit condition names nothing;
 *   5. a question with no stage, or in two stages, or a stage entry that names no question;
 *   6. an attempt count over the policy budget, or a re-open with no new evidence.
 *
 * It is a *process* gate and deliberately not part of `npm run verify`; see `docs/CLARITY.md` §6 for
 * why, and `tests/quality/clarity.spec.ts` for what proves this script can fail.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The stage names the protocol defines. A stage may be empty; it may not be absent. */
export const REQUIRED_STAGES = [
  "goals",
  "acceptance-criteria",
  "validation-planning",
  "unknowns",
  "planning",
  "react-iterations",
];

/** The only four states. There is deliberately no `tbd`. */
export const STATES = ["self-resolved", "escalated", "open-with-exit", "withdrawn"];

/**
 * Evidence must point at something re-runnable: a command, a file or a probe. This is the rule that
 * separates a resolution from a recollection.
 */
export const REDUCIBLE_EVIDENCE = [
  /->/,
  /^\s*\$/,
  /\.(ts|js|json|md|yaml|css|html)\b/,
  /\b(status|exit|HTTP|GET|POST|DELETE)\b/,
];

/** An exit condition that names nothing is not an exit condition. */
const VAGUE_EXIT = /\b(tbd|to be decided|at some point|eventually|sometime|unspecified|somehow|maybe)\b/i;

/**
 * An exit condition also has to name the thing that closes it - a change, a section, a gate, a
 * command, a probe or an actor. "It will be resolved when we get there" names nothing, and the
 * difference between that and a parked question is exactly this: a named owner.
 */
const EXIT_NAMES_OWNER = /\b(change|section|spec|gate|test|probe|command|runtime|actor|person|user|host|release|version)\b/i;

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const isStringArray = (value) =>
  Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);

/**
 * Validate a parsed ledger. Pure, so the spec can prove each rule can fail without writing a file
 * for every case.
 */
export function auditLedger(ledger) {
  const failures = [];
  const add = (message) => {
    if (!failures.includes(message)) failures.push(message);
  };

  if (ledger === null || typeof ledger !== "object" || Array.isArray(ledger)) {
    return { failures: ["the ledger must be a JSON object"], questions: 0, byState: {}, coverage: {} };
  }

  if (ledger.version !== 1) add(`version is ${JSON.stringify(ledger.version)}, expected 1`);

  const policy = ledger.policy ?? {};
  const maxAttempts = policy.maxSelfPromptAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    add("policy.maxSelfPromptAttempts must be a positive integer");
  } else if (maxAttempts > 5) {
    add("policy.maxSelfPromptAttempts is above 5; the attempt budget bounds the loop and may not be raised here");
  }
  if (!Number.isInteger(policy.maxEscalationsPerQuestion) || policy.maxEscalationsPerQuestion > 1) {
    add("policy.maxEscalationsPerQuestion must be 0 or 1");
  }
  if (policy.reopenRequiresNewEvidence !== true) {
    add("policy.reopenRequiresNewEvidence must be true, so a settled question is not re-opened from memory");
  }

  // ---- stages ---------------------------------------------------------------------------------
  const stages = Array.isArray(ledger.stages) ? ledger.stages : [];
  const stageNames = stages.map((entry) => entry?.stage);
  const coverage = {};

  for (const required of REQUIRED_STAGES) {
    const count = stageNames.filter((name) => name === required).length;
    if (count === 0) add(`stage ${required} is missing; an empty stage is recorded as empty, not omitted`);
    if (count > 1) add(`stage ${required} appears ${count} times`);
    coverage[required] = 0;
  }
  for (const name of stageNames) {
    if (!REQUIRED_STAGES.includes(name)) add(`stage ${JSON.stringify(name)} is not a stage the protocol defines`);
  }

  // ---- questions ------------------------------------------------------------------------------
  const questions = Array.isArray(ledger.questions) ? ledger.questions : [];
  if (questions.length === 0) add("the ledger records no questions");

  const byState = {};
  const known = new Map();
  let previousIndex = -1;

  for (const question of questions) {
    const id = question?.id;
    const label = isNonEmptyString(id) ? id : "(question with no id)";

    if (!isNonEmptyString(id)) {
      add("a question has no id");
    } else if (!/^Q\d+$/.test(id)) {
      add(`${label} does not match Q<number>`);
    } else if (known.has(id)) {
      add(`${label} appears twice`);
    } else {
      known.set(id, question);
      const index = Number.parseInt(id.slice(1), 10);
      if (index <= previousIndex) add(`${label} breaks the ascending id order`);
      previousIndex = index;
    }

    if (!isNonEmptyString(question?.question)) add(`${label} has no question text`);
    if (typeof question?.critical !== "boolean") add(`${label} does not say whether it is critical`);
    if (!isStringArray(question?.artifactsTried)) {
      add(`${label} records no artifacts tried; a resolution that tried nothing is a guess`);
    }
    if (!REQUIRED_STAGES.includes(question?.stage)) {
      add(`${label} has stage ${JSON.stringify(question?.stage)}, which is not a stage the protocol defines`);
    }

    const attempts = question?.attempts;
    if (!Number.isInteger(attempts) || attempts < 0) {
      add(`${label} has no attempt count`);
    } else if (Number.isInteger(maxAttempts) && attempts > maxAttempts) {
      add(`${label} took ${attempts} self-prompt attempts, over the budget of ${maxAttempts}`);
    }

    if (Array.isArray(question?.reopens) && question.reopens.length > 0 && !isStringArray(question?.newEvidence)) {
      add(`${label} was re-opened without naming new evidence`);
    }

    const state = question?.state;
    if (!STATES.includes(state)) {
      add(`${label} has state ${JSON.stringify(state)}, which is not one of ${STATES.join(", ")}`);
      continue;
    }
    byState[state] = (byState[state] ?? 0) + 1;

    if (state === "self-resolved") {
      if (!isStringArray(question.evidence)) {
        add(`${label} is self-resolved with no evidence`);
      } else {
        for (const item of question.evidence) {
          if (!REDUCIBLE_EVIDENCE.some((pattern) => pattern.test(item))) {
            add(`${label} cites evidence that is not a command, a file or a probe: ${JSON.stringify(item)}`);
          }
        }
      }
      if (!isNonEmptyString(question.doesNotEstablish)) {
        add(`${label} does not state what its evidence fails to establish`);
      }
      if (!isNonEmptyString(question.resolution)) add(`${label} is self-resolved with no resolution`);
    }

    if (state === "escalated") {
      if (question.critical !== true) {
        add(`${label} was escalated without being critical; a non-critical question is parked, not asked`);
      }
      const escalation = question.escalation ?? {};
      if (!isNonEmptyString(escalation.question)) add(`${label} was escalated with no question to put to a person`);
      if (!isNonEmptyString(escalation.whyArtifactsFailed)) {
        add(`${label} was escalated without recording why the artifacts did not reach it`);
      }
      if (!isNonEmptyString(escalation.decidedBy)) add(`${label} was escalated with no one to answer it`);
      const rounds = question.escalations ?? 1;
      if (!Number.isInteger(rounds) || rounds > policy.maxEscalationsPerQuestion) {
        add(`${label} was escalated ${rounds} times, over the policy limit`);
      }
    }

    if (state === "open-with-exit") {
      const exit = question.exitCondition;
      if (!isNonEmptyString(exit)) {
        add(`${label} is open with no exit condition; an open question with no exit never closes`);
      } else if (VAGUE_EXIT.test(exit)) {
        add(`${label} has an exit condition that names nothing: ${JSON.stringify(exit)}`);
      } else if (!EXIT_NAMES_OWNER.test(exit)) {
        add(`${label} has an exit condition that names no change, section, gate, probe or actor: ${JSON.stringify(exit)}`);
      }
    }

    if (state === "withdrawn" && !isNonEmptyString(question.reason)) {
      add(`${label} was withdrawn with no reason`);
    }
  }

  // ---- stage coverage ------------------------------------------------------------------------
  const placed = new Map();
  for (const stage of stages) {
    for (const id of Array.isArray(stage?.entries) ? stage.entries : []) {
      if (!known.has(id)) {
        add(`stage ${stage.stage} lists ${JSON.stringify(id)}, which is not a question in the ledger`);
        continue;
      }
      const count = (placed.get(id) ?? 0) + 1;
      placed.set(id, count);
      coverage[stage.stage] = (coverage[stage.stage] ?? 0) + 1;
    }
  }

  for (const question of questions) {
    const id = question?.id;
    if (!isNonEmptyString(id)) continue;
    const count = placed.get(id) ?? 0;
    if (count === 0) add(`${id} belongs to no stage`);
    if (count > 1) add(`${id} belongs to ${count} stages`);
    if (count === 1 && known.get(id)?.stage !== stageOf(stages, id)) {
      add(`${id} says stage ${known.get(id)?.stage} but is listed under ${stageOf(stages, id)}`);
    }
  }

  return { failures, questions: questions.length, byState, coverage };
}

function stageOf(stages, id) {
  for (const stage of stages) {
    if (Array.isArray(stage?.entries) && stage.entries.includes(id)) return stage.stage;
  }
  return undefined;
}

/** Read and audit the ledger at `file`. Returns the report plus the resolved path. */
export function checkLedger(file) {
  if (!existsSync(file)) {
    return { file, failures: [`no ledger at ${file}`], questions: 0, byState: {}, coverage: {} };
  }
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { file, failures: [`the ledger is not valid JSON: ${error.message}`], questions: 0, byState: {}, coverage: {} };
  }
  return { file, ...auditLedger(ledger) };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "docs", "clarity-ledger.json");
  const report = checkLedger(target);
  const say = (message) => console.log(`[clarity] ${message}`);

  say(`ledger           : ${path.relative(root, report.file).split(path.sep).join("/")}`);
  say(`questions        : ${report.questions} (${Object.entries(report.byState).map(([state, count]) => `${state}=${count}`).join(" ") || "none"})`);
  say(`stage coverage   : ${Object.entries(report.coverage).map(([stage, count]) => `${stage}=${count}`).join(" ")}`);

  if (report.failures.length === 0) {
    say("OK - every question has a state, a stage, reducible evidence, and an exit where it needs one");
    process.exit(0);
  }

  say(`FAIL - ${report.failures.length} unresolved question(s):`);
  for (const failure of report.failures) console.log(`  - ${failure}`);
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main();
