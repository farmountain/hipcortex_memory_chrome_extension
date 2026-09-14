/**
 * Types for `scripts/clarity.js`, so the spec can exercise the pure ledger audit in-process instead
 * of spawning a Node process per case. The script itself is plain ESM JavaScript and is not compiled;
 * this declaration exists only to give `tests/quality/clarity.spec.ts` a typed import.
 */

export interface ClarityReport {
  /** Every rule violation found. Empty means the ledger satisfies the protocol. */
  failures: string[];
  questions: number;
  byState: Record<string, number>;
  coverage: Record<string, number>;
}

export declare const REQUIRED_STAGES: string[];
export declare const STATES: string[];
export declare const REDUCIBLE_EVIDENCE: RegExp[];

/** Validate a parsed ledger. Pure: no file access, no exit code. */
export declare function auditLedger(ledger: unknown): ClarityReport;

/** Read and audit the ledger at `file`. */
export declare function checkLedger(file: string): ClarityReport & { file: string };
