/**
 * A recording transport for capture specs (tasks 6.7, 6.14, G7.5).
 *
 * The claim these specs make is usually an *absence* — "the transport was never called" — so the
 * stub's primary output is the ordered list of records it was handed, not a canned reply. The
 * retrieval methods reject loudly instead of returning an empty result: a spec that accidentally
 * exercises one should fail, not quietly pass on a fabricated `SearchResult`.
 */

import type {
  SendFailureKind,
  SendFailureReason,
  SendResult,
  Transport,
} from "../../src/api/transport/index.js";
import type { MemoryRecord } from "../../src/types/index.js";

export type EgressRecord = MemoryRecord;

export type TransportReply =
  | SendResult
  | ((record: EgressRecord) => SendResult | Promise<SendResult>);

export interface TransportStub {
  readonly transport: Transport;
  /** Every record handed to `addMemory`, in call order. */
  readonly records: readonly EgressRecord[];
  /** How many times a capture was offered to the transport. */
  readonly calls: number;
  setReply(next: TransportReply): void;
}

export function acknowledged(recordId: string): SendResult {
  return { acknowledged: true, transport: "http", recordId, warning: [] };
}

/**
 * A failed send from the stub.
 *
 * The default is a transient outcome, because that is what most specs using the stub exercise; a
 * spec about a refusal passes `kind: "refused"` and the runtime's own words explicitly, so the
 * default cannot make a refusal spec pass for the wrong reason.
 */
export function refused(
  reason: SendFailureReason = "UNREACHABLE",
  failure: { readonly kind?: SendFailureKind; readonly refusalReason?: string } = {}
): SendResult {
  return {
    acknowledged: false,
    transport: "http",
    reason,
    detail: "spec stub refused the capture",
    kind: failure.kind ?? "transient",
    refusalReason: failure.refusalReason ?? null,
  };
}

export function createTransportStub(reply: TransportReply = acknowledged("rec-1")): TransportStub {
  const records: EgressRecord[] = [];
  let current: TransportReply = reply;

  const unused = (method: string): never => {
    throw new Error(`transport stub: ${method}() is not part of this spec`);
  };

  const transport: Transport = {
    name: "http",
    mode: "developer",
    health: () => Promise.reject(new Error("transport stub: health() is not part of this spec")),
    resolve: () => Promise.reject(new Error("transport stub: resolve() is not part of this spec")),
    search: () => unused("search"),
    queryStructured: () => unused("queryStructured"),
    async addMemory(record: MemoryRecord): Promise<SendResult> {
      records.push(record);
      return typeof current === "function" ? current(record) : current;
    },
  };

  return {
    transport,
    records,
    get calls(): number {
      return records.length;
    },
    setReply(next: TransportReply): void {
      current = next;
    },
  };
}
