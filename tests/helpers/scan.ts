/**
 * Source-scanning helpers used by the quality-gate specs (task 1.6).
 *
 * `scanSource()` is the only way a spec reads production code. That matters because most of the
 * gates in this plan are negative assertions — "`/memory/ingest` appears nowhere under `src/`",
 * "no provider hostname outside `src/capture/**`". A hand-maintained file list would make those
 * assertions silently vacuous the first time a file moved; walking the tree makes coverage a
 * property of the helper rather than of the author's memory.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SourceFile {
  /** Path relative to the repository root, always with forward slashes. */
  path: string;
  content: string;
}

export interface Violation {
  /** Path relative to the repository root, always with forward slashes. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  /** The matching line, trimmed. */
  text: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const SRC_DIR = path.join(REPO_ROOT, "src");
export const PUBLIC_DIR = path.join(REPO_ROOT, "public");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

export function toRepoRelative(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

/** Every file under `dir`, recursively, with its content. Sorted for stable assertions. */
export function scanTree(dir: string): SourceFile[] {
  return walk(dir)
    .sort()
    .map((file) => ({ path: toRepoRelative(file), content: readFileSync(file, "utf8") }));
}

/** Every file under `src/`, recursively. The canonical production-source view. */
export function scanSource(): SourceFile[] {
  return scanTree(SRC_DIR);
}

/** Every line matching `pattern`, across the supplied files. */
export function findViolations(files: SourceFile[], pattern: RegExp): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] as string;
      if (pattern.test(line)) {
        violations.push({ path: file.path, line: index + 1, text: line.trim() });
      }
    }
  }
  return violations;
}

/** Paths of the files whose content matches `pattern`. */
export function pathsWith(files: SourceFile[], pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(file.content)).map((file) => file.path);
}
