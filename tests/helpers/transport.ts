/**
 * Narrowing helpers for `SendResult` (task 4.5 onward).
 *
 * `SendResult` is a discriminated union on `acknowledged`, and the specs have to make claims about
 * the failure branch. Asserting on the union directly would let a spec pass while the result was
 * actually acknowledged — e.g. `expect(result.reason)` on a union that has no `reason` — so these
 * helpers fail loudly instead, and they report what actually happened.
 */

import type { SendResult } from "../../src/api/transport/types.js";

export type AcknowledgedResult = Extract<SendResult, { acknowledged: true }>;
export type UnacknowledgedResult = Extract<SendResult, { acknowledged: false }>;

export function expectAcknowledged(result: SendResult): AcknowledgedResult {
  if (!result.acknowledged) {
    throw new Error(
      `Expected an acknowledged capture, got ${result.reason} (${result.transport}): ${result.detail}`
    );
  }
  return result;
}

export function expectUnacknowledged(result: SendResult): UnacknowledgedResult {
  if (result.acknowledged) {
    throw new Error(
      `Expected an unacknowledged capture, but it was acknowledged with record_id ${result.recordId}`
    );
  }
  return result;
}
