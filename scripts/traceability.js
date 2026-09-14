/**
 * Traceability gate (task 9.14, G6.8).
 *
 * `docs/END-STATE.md` declares the measurable acceptance criteria; each change's `specs/` files,
 * one per capability, must cite the criteria their requirements discharge; `tasks.md` records the
 * test path that proves each task. Nothing in the toolchain connects those three documents, so a criterion can quietly
 * stop being cited, a requirement can cite an id that was renumbered out of existence, and a task
 * can name a test file that was never written — all while every existing gate stays green, because
 * each of those gates reads code and none of them reads the plan.
 *
 * This script is the gate that reads the plan. It fails on exactly three conditions:
 *
 *   1. a criterion defined in `docs/END-STATE.md` is cited by no `### Requirement:` heading,
 *   2. a requirement heading cites a criterion that `docs/END-STATE.md` does not define,
 *   3. a test path cited in a `tasks.md`, or in the acceptance-criteria table of
 *      `docs/END-STATE.md`, does not exist on disk.
 *
 * Condition 3 originally read `tasks.md` only. That left the one column that says *how* a criterion
 * is proved unchecked, and it was wrong: the table cited a spec whose two words were transposed and
 * which had never existed. The column that carries the verification claim is part of the plan, so it
 * is read by the same rule.
 *
 * It is deliberately a *plan* check, not a *behaviour* check: it proves every claim is anchored,
 * not that the anchor is truthful. The truthfulness of each anchor is what the cited spec proves.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** `G1.1`, `G8.12` — any `G<digits>.<digits>` id. */
export function idsIn(text) {
  return [...text.matchAll(/G\d+\.\d+/g)].map((match) => match[0]);
}

/**
 * Criteria declared in the acceptance-criteria tables of `docs/END-STATE.md`.
 * Returns a `Map` so the audit can iterate declarations rather than citations.
 */
export function parseCriteria(source) {
  const criteria = new Map();

  source.split(/\r?\n/).forEach((line, index) => {
    const match = /^\|\s*(G\d+\.\d+)\s*\|/.exec(line);
    if (!match) return;
    const id = match[1];
    if (criteria.has(id)) return;
    criteria.set(id, { id, line: index + 1, description: line.trim() });
  });

  return criteria;
}

/**
 * Criterion ids cited by requirement headings.
 *
 * Only `### Requirement:` headings count. A scenario may mention an id for context, but scenarios
 * are the *evidence* for a requirement, so accepting one there would let a criterion become
 * unreachable at the requirement level while the gate stayed green.
 */
export function parseRequirementCitations(sources) {
  const citations = [];

  for (const file of sources) {
    file.content.split(/\r?\n/).forEach((line, index) => {
      if (!/^###\s+Requirement:/.test(line)) return;
      for (const id of idsIn(line)) {
        citations.push({ id, path: file.path, line: index + 1, heading: line.trim() });
      }
    });
  }

  return citations;
}

/**
 * Backticked `tests/...` paths cited by a plan file. Directories are valid citations.
 *
 * The path must sit inside a backticked span; a bare mention in prose is not a claim. The span may
 * be the bare path (`tests/quality/manifest.spec.ts`) or a whole command
 * (`npm test -- tests/index/offline-search.spec.ts`), which is how the acceptance-criteria table
 * states its verification, so the span is scanned for the path rather than the path anchored to the
 * opening backtick.
 */
export function parseTestPathCitations(sources) {
  const citations = [];

  for (const file of sources) {
    file.content.split(/\r?\n/).forEach((line, index) => {
      for (const span of line.matchAll(/`([^`]+)`/g)) {
        for (const found of span[1].matchAll(/tests\/[A-Za-z0-9_./-]+/g)) {
          citations.push({
            raw: found[0],
            path: found[0].replace(/\/+$/, ""),
            filePath: file.path,
            line: index + 1,
          });
        }
      }
    });
  }

  return citations;
}

/** Apply the three conditions. Pure, so the spec can prove the gate is able to fail. */
export function audit({ criteria, requirementCitations, testCitations, exists }) {
  const failures = [];
  const seen = new Set();
  const add = (message) => {
    if (seen.has(message)) return;
    seen.add(message);
    failures.push(message);
  };

  const citedIds = new Set(requirementCitations.map((citation) => citation.id));

  for (const id of criteria.keys()) {
    if (!citedIds.has(id)) add(`criterion ${id} is cited by no requirement heading`);
  }

  for (const citation of requirementCitations) {
    if (!criteria.has(citation.id)) {
      add(`${citation.path}:${citation.line} cites ${citation.id}, which docs/END-STATE.md does not define`);
    }
  }

  for (const citation of testCitations) {
    if (!exists(citation.path)) {
      add(`${citation.filePath}:${citation.line} cites ${citation.raw}, which does not exist`);
    }
  }

  return {
    failures,
    criteria: criteria.size,
    criteriaCited: [...criteria.keys()].filter((id) => citedIds.has(id)).length,
    requirements: new Set(requirementCitations.map((citation) => `${citation.path}:${citation.line}`)).size,
    testCitations: testCitations.length,
    // Which files the test-path rule actually read. Returned so a spec can prove that the
    // acceptance-criteria table is one of them rather than assuming it.
    testCitationFiles: [...new Set(testCitations.map((citation) => citation.filePath))].sort(),
  };
}

/** The plan files this gate reads, in a stable order. */
export function planFiles(root) {
  const result = { endState: path.join(root, "docs", "END-STATE.md"), specs: [], tasks: [] };
  const changesDir = path.join(root, "openspec", "changes");
  if (!existsSync(changesDir)) return result;

  for (const change of readdirSync(changesDir, { withFileTypes: true })) {
    if (!change.isDirectory()) continue;
    const changeDir = path.join(changesDir, change.name);
    const specsDir = path.join(changeDir, "specs");
    if (existsSync(specsDir)) {
      for (const entry of readdirSync(specsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) result.specs.push(path.join(specsDir, entry.name, "spec.md"));
      }
    }
    const tasks = path.join(changeDir, "tasks.md");
    if (existsSync(tasks)) result.tasks.push(tasks);
  }

  result.specs.sort();
  result.tasks.sort();
  return result;
}

export function checkTraceability(root) {
  const files = planFiles(root);
  const read = (absolute) => ({ path: path.relative(root, absolute).split(path.sep).join("/"), content: readFileSync(absolute, "utf8") });

  const endState = read(files.endState);
  const criteria = parseCriteria(endState.content);
  const requirementCitations = parseRequirementCitations(files.specs.filter(existsSync).map(read));
  // The criteria table states its own verification, so it is a source of test paths alongside the
  // tasks files. `endState` is read once and reused, so the two rules cannot disagree about it.
  const testCitations = parseTestPathCitations([
    endState,
    ...files.tasks.filter(existsSync).map(read),
  ]);

  return audit({
    criteria,
    requirementCitations,
    testCitations,
    exists: (relative) => existsSync(path.join(root, relative)),
  });
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const report = checkTraceability(root);
  const say = (message) => console.log(`[traceability] ${message}`);

  say(`criteria declared : ${report.criteria} (docs/END-STATE.md)`);
  say(`criteria cited    : ${report.criteriaCited}/${report.criteria} by ${report.requirements} requirement headings`);
  say(`test paths cited  : ${report.testCitations} in the plan`);

  if (report.failures.length === 0) {
    say("OK — every criterion is cited and every cited test path exists");
    process.exit(0);
  }

  say(`FAIL — ${report.failures.length} unresolved claim(s):`);
  for (const failure of report.failures) console.log(`  - ${failure}`);
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) main();
