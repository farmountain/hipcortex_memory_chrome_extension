/**
 * Types for `scripts/traceability.js` (task 9.14, G6.8).
 *
 * The traceability gate is plain JavaScript because it is run directly by `node scripts/traceability.js`
 * as an npm script, outside the TypeScript project. `tests/quality/traceability.spec.ts` imports its
 * pure functions to prove the gate can fail, and without this declaration file that import would be
 * an implicit `any` and would fail `npm run typecheck` under `strict`.
 *
 * The declaration is intentionally narrower than the module: `main()` is not exported here because
 * nothing but the CLI calls it.
 */

export interface PlanSource {
  /** Path relative to the repository root, always with forward slashes. */
  path: string;
  content: string;
}

export interface Criterion {
  id: string;
  /** 1-based line number in `docs/END-STATE.md`. */
  line: number;
  description: string;
}

export interface RequirementCitation {
  id: string;
  /** Path of the spec file that cites the criterion. */
  path: string;
  /** 1-based line number of the requirement heading. */
  line: number;
  heading: string;
}

export interface TestCitation {
  /** The citation exactly as written, including any trailing slash. */
  raw: string;
  /** The cited path with trailing slashes removed — a directory is a valid citation. */
  path: string;
  /** Path of the plan file that makes the citation. */
  filePath: string;
  /** 1-based line number of the citation. */
  line: number;
}

export interface AuditInput {
  criteria: Map<string, Criterion>;
  requirementCitations: RequirementCitation[];
  testCitations: TestCitation[];
  /** Resolves a repository-relative path to whether it exists. */
  exists: (relative: string) => boolean;
}

export interface AuditReport {
  failures: string[];
  criteria: number;
  criteriaCited: number;
  requirements: number;
  testCitations: number;
  /** Which files the test-path rule actually read, so a spec can prove the criteria table is among them. */
  testCitationFiles: string[];
}

export function idsIn(text: string): string[];

export function parseCriteria(source: string): Map<string, Criterion>;

export function parseRequirementCitations(sources: PlanSource[]): RequirementCitation[];

export function parseTestPathCitations(sources: PlanSource[]): TestCitation[];

export function audit(input: AuditInput): AuditReport;

export function planFiles(root: string): { endState: string; specs: string[]; tasks: string[] };

export function checkTraceability(root: string): AuditReport;
