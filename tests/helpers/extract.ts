/**
 * Narrowing helpers for `ExtractResult` (task 5.7).
 *
 * `expect(result.ok).toBe(true)` does not narrow a union in TypeScript, so a spec written that way
 * ends up asserting on `result.conversation` through a cast — and a cast that is wrong typechecks
 * fine and fails at runtime with a confusing error. These helpers fail with the actual code and
 * detail instead, which is also what makes a red test readable.
 */

import type { ExtractFailure, ExtractResult, ExtractSuccess } from "../../src/capture/providers/types.js";

export function expectExtractSuccess(result: ExtractResult): ExtractSuccess {
  if (!result.ok) {
    throw new Error(`expected a successful extraction, got ${result.code}: ${result.detail}`);
  }
  return result;
}

export function expectExtractFailure(result: ExtractResult): ExtractFailure {
  if (result.ok) {
    throw new Error(
      `expected a typed extraction failure, got a success with ${result.conversation.messages.length} message(s)`
    );
  }
  return result;
}
