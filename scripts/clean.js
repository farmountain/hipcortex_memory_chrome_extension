/**
 * Cross-platform replacement for `rm -rf dist` (tasks 1.8, 1.9).
 *
 * The old `clean` script was POSIX-only: PowerShell 5.1 raises `NamedParameterNotFound` for
 * `rm -rf` (recorded in `AGENTS.md`). `fs.rmSync` with `force: true` is a no-op when the directory
 * is absent, which makes the script idempotent — the property task 1.9 verifies by running it
 * twice.
 */

import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

rmSync(dist, { recursive: true, force: true });

console.log(`[clean] ${path.relative(root, dist)}/ removed (no-op when it was already absent)`);
