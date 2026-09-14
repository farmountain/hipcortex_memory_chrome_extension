/**
 * HipCortex Chrome Extension — Core Types
 * Layer 3 / 4 abstractions: Implementation Units, Knowledge Graph nodes
 */

import type { ExtractResult } from "../capture/providers/types.js";
import type { DriftStatus } from "../capture/drift.js";
import type { RetentionState } from "../capture/queue/queue.js";
import type { TransportResolution } from "../api/transport/types.js";

export interface MemoryRecord {
  id?: string;
  actor: string;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  /**
   * The extension's egress records carry these as `readonly` arrays and nothing in this repo mutates
   * them (the transport only serialises them), so the type is widened to match the producer instead
   * of copying arrays at every call site to satisfy a mutability nobody needs.
   */
  causal_parents?: readonly string[];
  confidence?: number;
  record_type?: string;
  source?: string;
  tags?: readonly string[];
  /**
   * The runtime's own priority for a record (`"normal"`, `"pinned"`, …), when the caller states one.
   *
   * It exists because the export leg states it and the import leg has to keep it (G4.2): the runtime
   * stores what an add body carries — verified, `docs/PROTOCOL.md` section 6 and
   * `openspec/changes/substrate-migration/design.md` decision 2 — so a migration that omitted this
   * field would silently turn a pinned memory into an ordinary one. Captures never set it, so an
   * absent value stays absent from the body and capture egress is unchanged.
   */
  priority?: string;
  /**
   * Discrete provider identity, read out of the reserved metadata object on the way back from the
   * runtime. It is a field rather than a convention so that a caller can filter on it without
   * parsing prose (G3.1), and it is absent for any record that is not a capture.
   */
  provider?: string;
  /** Semantic similarity. Only the semantic path produces it. */
  score?: number;
}

export interface SearchResult {
  results: MemoryRecord[];
  count?: number;
  query?: string;
  /**
   * Set when the request could not be served as asked — e.g. a provider filter on the semantic
   * path. The UI must present it rather than implying the results are scoped (G3.6).
   */
  limitation?: string;
  /**
   * Which path answered (G3.9). `local` is the index held in this browser; `core` is the runtime's
   * semantic search. A surface must say which one it is showing, because "no matches" means
   * different things: nothing captured here contains that, versus the core had nothing.
   */
  source?: SearchScope;
  /**
   * How many records the local index held when the query ran. It is what separates "the index is
   * empty" from "nothing matched", which are the same empty list and different situations.
   */
  indexed?: number;
  /** Query tokens that matched no record, so a surface can name what narrowed the search away. */
  unmatchedTokens?: readonly string[];
}

/**
 * Which search a query is asking for (G3.9).
 *
 * `local` is the default and never touches the network: it answers from the index over acknowledged
 * captures, so it works with the runtime stopped. `core` is the explicit choice to ask the runtime
 * for its semantic search, which is what keeps "the offline path" a *named* path rather than a
 * fallback that silently changes what a result means.
 */
export type SearchScope = "local" | "core";

/**
 * The reply to `CLEAR_SEARCH_INDEX`.
 *
 * It carries both numbers on purpose. The user asked to clear one thing, and the surface says which
 * one was cleared and that the other is untouched (G3.9) — a bare `success` would leave the two
 * stores to be told apart from memory.
 */
export interface SearchIndexReport {
  /** Index records removed by this action. */
  readonly cleared: number;
  /** Index records remaining afterwards — always zero. */
  readonly indexed: number;
  /** Undelivered captures, which this action did not touch (G4.1). */
  readonly unacknowledged: number;
}

/**
 * The reply to `INDEX_STATUS` — what the local index holds right now (G3.9).
 *
 * `providers` is read out of the index rather than declared in a surface. A surface that listed the
 * providers it knows about would offer a filter that matches nothing, and it would put provider
 * knowledge in a UI layer — the one place the containment scan exists to keep it out of.
 */
export interface SearchIndexStatus {
  /** How many acknowledged captures are searchable with the runtime stopped. */
  readonly indexed: number;
  /** Distinct providers among those captures, in first-seen order. */
  readonly providers: readonly string[];
}

/**
 * Why a placement ended without text in a composer (G4.5).
 *
 * Every code is a state a person can act on differently, which is the only reason to have more than
 * one. `INJECTION_DISABLED` and `NO_TARGET_TAB` are the extension's own preconditions; `CONTEXT_NOT_FOUND`
 * means the capture is no longer held here (the index is a cache — G3.9); `TAB_UNREACHABLE` means the
 * page did not answer, which includes being on a page this extension has no content script for;
 * `UNSUPPORTED_PROVIDER` and `DOM_SHAPE_UNRECOGNIZED` mean the composer could not be found;
 * `COMPOSER_AMBIGUOUS` means more than one node matched a rung and choosing one would be a guess;
 * `COMPOSER_NOT_WRITABLE` means the node exists and will not accept text; `CONTEXT_EMPTY` means there
 * is nothing to place.
 *
 * There is deliberately no code meaning "placed but the page may not have noticed": the report says
 * where the text went (`wroteInto`), and whether the provider's own framework picked it up is a fact
 * about that page rather than an outcome of this one.
 */
export const PLACEMENT_REFUSAL_CODES = [
  "INJECTION_DISABLED",
  "NO_TARGET_TAB",
  "TAB_UNREACHABLE",
  "CONTEXT_NOT_FOUND",
  "CONTEXT_EMPTY",
  "UNSUPPORTED_PROVIDER",
  "DOM_SHAPE_UNRECOGNIZED",
  "COMPOSER_AMBIGUOUS",
  "COMPOSER_NOT_WRITABLE",
] as const;

export type PlacementRefusalCode = (typeof PLACEMENT_REFUSAL_CODES)[number];

/**
 * The outcome of one placement attempt.
 *
 * It is a report rather than a bare boolean because four of the facts it carries are the ones a user
 * needs to trust the result: which provider page received the text (`providerId`, resolved by the
 * page itself from the URL), which of the two provider identities is the source (`sourceProvider`),
 * whether the text was cut to fit (`truncated` with the two lengths), and which rung of each slot
 * resolved (`rungs`) — a page that has drifted one rung away is visible here instead of being
 * absorbed silently.
 *
 * `submitted` does not appear, and its absence is the guarantee: nothing on this path dispatches a
 * submit, so there is no state in which placement implies sending.
 */
export interface PlaceContextReport {
  readonly placed: boolean;
  readonly code?: PlacementRefusalCode;
  readonly detail?: string;
  /** The provider whose composer resolved, as the page identified it from its own URL. */
  readonly providerId?: string;
  /** The provider the placed context was captured from. */
  readonly sourceProvider?: string;
  readonly placedChars?: number;
  readonly sourceChars?: number;
  readonly truncated?: boolean;
  readonly maxChars?: number;
  /** Which property the text was written into: `value` for a form control, `text` for editable. */
  readonly wroteInto?: "value" | "text";
  readonly rungs?: Readonly<Record<string, number>>;
}

/**
 * What happened to one record in an import (G4.2).
 *
 * The three terminal states are kept apart because they are three different things to do next.
 * `imported` with a `recordId` is a record the core confirmed. `refused` carries the transport's own
 * classification and the runtime's own words, because a PII refusal is deterministic and repeating the
 * import changes nothing. `duplicated` is neither: the runtime accepted the record and said it
 * overlaps one it already holds, and reporting that as a refusal would be the mirror image of the
 * mistake the acknowledgement rule forbids (G2.9).
 *
 * `previousId` is the identity the source document carried, which the runtime does not keep — it
 * regenerates `id` and `integrity` on import — so this is the pair the remap is built from.
 */
export interface ImportRecordOutcome {
  readonly index: number;
  readonly previousId?: string;
  readonly recordId?: string;
  readonly outcome: "imported" | "refused" | "failed";
  /** The transport's reason, when the record was not acknowledged. */
  readonly reason?: string;
  /**
   * What the transport reported about this record, verbatim.
   *
   * The runtime's own words when it refused one are in here — the transport owns that extraction, and
   * it is the string a person acts on. It is not copied into a field of its own: `refusalReason` is
   * the queue's name for a verdict about a *waiting* capture, and a report about an import reading it
   * is the kind of vocabulary leak the containment scan exists to catch (G2.1).
   */
  readonly detail?: string;
  /** True when the runtime accepted the record and reported that it overlaps an existing one. */
  readonly duplicated?: boolean;
}

/**
 * The reply to `IMPORT_DOCUMENT`.
 *
 * `failures` present and non-empty means the document was refused **before any record was written**,
 * which is the all-or-nothing rule made visible: a caller can tell "nothing happened" from "some
 * records were written and one was refused" without reading a sentence. `notes` are the reader's
 * accepted-but-interpreted facts (a defaulted version, a dropped core-owned field) and are never
 * folded into the counts, because a user who imported a document whose identity was regenerated is
 * exactly the user who would otherwise believe a byte-for-byte copy happened.
 */
export interface ImportReport {
  /** The actor the records were stamped with — the setting, since a document may be mixed. */
  readonly actor: string;
  readonly imported: number;
  readonly refused: number;
  /** Refused before the first write: the document itself, not a record. */
  readonly failures: readonly ImportFailure[];
  readonly notes: readonly ImportNote[];
  /** One per record the document carried, in document order. */
  readonly outcomes: readonly ImportRecordOutcome[];
}

/** One reason a document was refused whole. Mirrors the reader's own failure shape. */
export interface ImportFailure {
  readonly kind: string;
  /** Which record, by position. `null` when the failure is about the document. */
  readonly index: number | null;
  readonly field?: string;
  readonly detail: string;
}

/** Something the reader accepted but had to interpret. Reported, never silent. */
export interface ImportNote {
  readonly kind: string;
  readonly detail: string;
}

/**
 * The reply to `RESOLVE_PREVIOUS_ID` (G4.2).
 *
 * A remap entry is only a record of anything if it can be read back later, and the requirement says
 * "forever after". `found: false` is a real answer — the id may predate the remap store, or belong to
 * another browser — and is reported as one rather than as an error, because neither id is wrong.
 */
export interface RemapLookup {
  readonly previousId: string;
  readonly found: boolean;
  readonly recordId?: string;
  readonly action?: string;
  readonly importedAt?: string;
  /** How many imports the remap store holds, so an empty answer is distinguishable from an empty store. */
  readonly imports: number;
}

export interface HealthStatus {
  status: string;
  service?: string;
  version?: string;
  tier?: string;
  healthy: boolean;
  /**
   * Which of the distinguishable connection states was observed (G9.1).
   *
   * It exists because "unreachable" was one state covering two opposite situations: a host that
   * was never installed and a host whose core is merely stopped. They need opposite advice, so
   * collapsing them told users who had installed nothing to "check that HipCortex is running".
   * Optional because a transport that has only one failure mode has nothing to distinguish.
   */
  connection?: ConnectionState;
}

/**
 * The connection states a probe can report.
 *
 * `host-not-registered` means no browser-side install has happened, so there is nothing running to
 * restart and no amount of checking will help. `core-unreachable` means the install is complete and
 * the process on the other end is not answering. A surface that renders both the same way is not
 * reporting the state, it is guessing at it (G9.1).
 */
export type ConnectionState = "healthy" | "host-not-registered" | "core-unreachable";

/**
 * The reply to `HEALTH_CHECK`.
 *
 * It carries the probe *and* the resolution, because a status page that reports reachability without
 * naming which transport answered cannot tell a user why `consumer` mode is failing while HTTP is up
 * (G7.3). `TransportResolution` is the transport's own type rather than a copy, so a field added to
 * the resolution is a field this reply must carry — the connection test cannot go stale silently.
 */
export interface HealthReport {
  readonly health: HealthStatus;
  readonly resolution: TransportResolution;
}

/**
 * The reply to `CAPTURE_STATUS` — what the popup shows about passive capture.
 *
 * The queue's state is **one value** on purpose (task 1.2). Before it existed the popup read a
 * separate queue length, a separate paused flag and a separate message, which is three chances for
 * the screen to disagree with the store. Every count the popup shows is now counted from the entries
 * that are still in the queue, inside `retentionState`.
 *
 * There is no loss counter, here or anywhere else in the extension: a number named "lost" would be
 * a number the product could show while having discarded a conversation (G2.2, G2.3). `failures`
 * counts *diagnostic records* and is never presented as content that went missing.
 *
 * `refused` is not a second name for "failed". It counts entries the runtime answered `success:
 * false` about — a decision it explained and will repeat until its own condition changes — and each
 * one carries the runtime's own words in `refusals`. A transient failure is counted in `retrying`
 * and is retried. The two are never reported as each other (G2.2).
 */
export interface CaptureStatus {
  readonly autoCapture: boolean;
  readonly retention: RetentionState;
  readonly needsAttention: readonly DriftStatus[];
  readonly failures: number;
}

/**
 * How a capture leaves the browser.
 *
 * - `auto` — prefer Native Messaging (the desktop app), fall back to loopback HTTP.
 * - `consumer` — Native Messaging only. An explicit choice does **not** silently fall back.
 * - `developer` — loopback HTTP only; native is never attempted.
 */
export type TransportMode = "auto" | "consumer" | "developer";

export const TRANSPORT_MODES: readonly TransportMode[] = ["auto", "consumer", "developer"];

export interface ExtensionSettings {
  apiUrl: string;
  apiKey: string;
  defaultActor: string;
  autoCapture: boolean;
  injectIntoAiChats: boolean;
  headroomMode: boolean;
  transportMode: TransportMode;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: "http://127.0.0.1:3030",
  apiKey: "",
  defaultActor: "browser-user",
  autoCapture: false,
  injectIntoAiChats: false,
  headroomMode: true,
  transportMode: "auto",
};

/**
 * Every message the worker can receive.
 *
 * `CAPTURE_UPDATE` carries the perception result *as the adapter produced it* rather than a
 * `CaptureEvent`, because normalization is the worker's job: it is the step that validates, and a
 * validator that runs in the page is a validator the page can skip. `url` is the raw page URL for
 * diagnosis only — the event's canonical URL is stamped by the adapter's own extraction.
 *
 * The capture variants are declared here (not in the capture layer) so that the router and the
 * content script agree on one shape, and so a spec can enumerate every variant and require a
 * handling case for each (G6.5).
 */
export type MessageType =
  | { type: "GET_SETTINGS" }
  | {
      type: "SAVE_SETTINGS";
      settings: Partial<ExtensionSettings>;
      /**
       * The host the user confirmed, for a save that would make captures leave the machine (G7.2).
       * It must equal the host of the new `apiUrl` exactly; the worker refuses the save otherwise, so
       * "cannot persist without a confirmation naming the host" is enforced where persistence
       * happens rather than only in the one surface that happens to render a dialog today.
       */
      confirmRemoteHost?: string;
    }
  | { type: "HEALTH_CHECK" }
  | { type: "ADD_MEMORY"; record: MemoryRecord }
  /**
   * A search. `scope` defaults to `local`: the index over acknowledged captures, answered without a
   * request, so a search works with the runtime stopped (G3.9). `core` asks the runtime for its
   * semantic search instead. `provider` is applied locally on the `local` path and passed through as
   * the runtime's own filter on the `core` path.
   */
  | { type: "SEARCH_MEMORY"; query: string; limit?: number; scope?: SearchScope; provider?: string }
  | { type: "INDEX_STATUS" }
  | { type: "CLEAR_SEARCH_INDEX" }
  | { type: "QUICK_ADD_SELECTION"; text: string; url?: string; title?: string }
  /**
   * Place an acknowledged capture into the composer of the provider page the user is on (G4.5).
   *
   * The surface names a record; it never carries the conversation. `indexedId` is the `record_id`
   * the core returned, so the text that is placed is text the core already holds and this extension
   * is never the author of it. The worker reads the flag, reads the record and messages the active
   * tab; the page resolves the composer and writes. Neither side holds both halves, which is what
   * lets the off state be decided before any page is spoken to at all.
   */
  | { type: "PLACE_CONTEXT"; indexedId: string }
  | { type: "CAPTURE_UPDATE"; providerId: string; url: string; result: ExtractResult }
  | { type: "CAPTURE_STATUS" }
  /**
   * The user's exit from a backlog that cannot be delivered (G4.1).
   *
   * It is a request rather than a fire-and-forget because the document is what the user keeps: the
   * surface that asked for it writes the file, and a surface cannot write a document it was never
   * given. The reply is an `ExportDocument` in the core's own export shape.
   */
  | { type: "EXPORT_QUEUE" }
  /**
   * Take a document this repository exported and write its records into a core (G4.2).
   *
   * `text` is the file's **text**, not a parsed document, and that is the design: parsing happens
   * once, next to the reader, so a surface cannot hand the importer a record the reader never
   * accepted and "one reader" stays true through the parse step. The reply is an `ImportReport`.
   */
  | { type: "IMPORT_DOCUMENT"; text: string }
  /**
   * Resolve an identity from before an import to the one the core issued (G4.2).
   *
   * It is a separate message because "the remap resolves an old id" has to be observable without
   * re-importing anything, and because the answer is a fact about the store rather than about a
   * document. The reply is a `RemapLookup`.
   */
  | { type: "RESOLVE_PREVIOUS_ID"; previousId: string };

export type MessageResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};
