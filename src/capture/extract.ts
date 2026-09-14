/**
 * The shared extraction helper — one implementation of "read this DOM honestly, or refuse".
 *
 * The order of operations is the whole point of the file:
 *
 * 1. **Landmark pre-check.** Every declared landmark must exist. A miss returns
 *    `DOM_SHAPE_UNRECOGNIZED` and the function exits *before* any `textContent` is touched — G8.3.
 *    This is what makes a wrong capture structurally hard rather than merely unlikely: the adapter
 *    cannot "helpfully" pull text out of a page it does not recognise.
 * 2. **Slot resolution by ladder.** Each slot walks its ordered ladder and the first rung that
 *    produces something wins, recording the index — G8.2.
 * 3. **Cardinality check.** The number of turn containers observed must equal the number of messages
 *    produced. If a turn was skipped, the capture is partial and fails — G8.8, G8.7.
 *
 * A skipped turn never becomes a success. That is deliberate: the core retains whatever it is told,
 * so a conversation that is quietly missing a turn is a memory defect that no later layer can
 * detect.
 */

import { CAPTURE_SOURCE, SCHEMA_VERSION } from "../schema/index.js";
import type { Attachment, Conversation, Message, MessageRole, Provenance } from "../schema/index.js";
import type {
  CaptureSlot,
  ExtractFailure,
  ExtractInput,
  ExtractResult,
  ProviderAdapter,
} from "./providers/types.js";

/**
 * Role attributes, most specific first. Both are read from the *same* element that satisfied the
 * `roleSignal` rung, so an adapter that matches `[data-author-role]` does not also need a second
 * ladder to say which attribute to read.
 */
const ROLE_ATTRIBUTES = ["data-message-author-role", "data-author-role"] as const;

/** A role label longer than this is prose, not a role token. Keeps a text rung from matching a body. */
const MAX_ROLE_TOKEN_LENGTH = 16;

const ROLE_ALIASES: Readonly<Record<string, MessageRole>> = {
  user: "user",
  human: "user",
  assistant: "assistant",
  ai: "assistant",
  model: "assistant",
  bot: "assistant",
  system: "system",
  tool: "tool",
  function: "tool",
  function_call: "tool",
};

function failure(
  code: ExtractFailure["code"],
  detail: string,
  extra: { slot?: CaptureSlot; rung?: number } = {}
): ExtractFailure {
  return { ok: false, code, detail, ...extra };
}

/** Strip the hash and query so the same conversation always hashes to the same provenance URL. */
function canonicalConversationUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    // An unparseable URL is not a DOM-shape problem, so it is not allowed to masquerade as one.
    // The raw string is still an honest answer to "where did this come from".
    return raw;
  }
}

interface Resolved {
  readonly element: Element;
  readonly rung: number;
}

function resolveScope(scope: ParentNode, ladder: readonly string[]): Resolved | null {
  for (let rung = 0; rung < ladder.length; rung++) {
    const element = scope.querySelector(ladder[rung]);
    if (element) return { element, rung };
  }
  return null;
}

/** The role token for an element: its role attribute, else a short text label. */
function readRoleToken(element: Element): { token: string; source: string } | null {
  for (const attribute of ROLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value && value.trim() !== "") {
      return { token: value.trim().toLowerCase(), source: attribute };
    }
  }
  const text = (element.textContent ?? "").trim().toLowerCase();
  if (text !== "" && text.length <= MAX_ROLE_TOKEN_LENGTH) {
    return { token: text, source: "text" };
  }
  return null;
}

interface ResolvedRole {
  readonly role: MessageRole;
  readonly rung: number;
}

interface RoleFailure {
  readonly error: string;
  readonly code: ExtractFailure["code"];
  readonly rung: number;
}

/**
 * Resolve a turn's role. The element itself is checked before its descendants, because every
 * observed provider marks the *turn container* rather than a nested label.
 *
 * Two failures are distinguished on purpose, because they call for different repairs:
 *
 * - **`NO_ROLE_SIGNAL`** — no rung matched at all. The attribute is gone or was renamed; the ladder
 *   needs a new rung.
 * - **`UNSUPPORTED_LAYOUT`** — a rung matched but its value was unusable: the carrier had no role
 *   value, or the value was a token the alias table does not know. The shape is right and the
 *   *content* is not, which is what a layout change inside the same container looks like.
 */
function resolveRole(turn: Element, ladder: readonly string[]): ResolvedRole | RoleFailure {
  for (let rung = 0; rung < ladder.length; rung++) {
    const selector = ladder[rung];
    const carrier = turn.matches(selector) ? turn : turn.querySelector(selector);
    if (!carrier) continue;

    const signal = readRoleToken(carrier);
    if (!signal) {
      return {
        error: `rung ${rung} (${selector}) matched but carries no role value`,
        code: "UNSUPPORTED_LAYOUT",
        rung,
      };
    }

    const role = ROLE_ALIASES[signal.token];
    if (!role) {
      return {
        error: `unrecognised role token "${signal.token}" via ${signal.source}`,
        code: "UNSUPPORTED_LAYOUT",
        rung,
      };
    }
    return { role, rung };
  }
  return { error: "no rung matched", code: "NO_ROLE_SIGNAL", rung: -1 };
}

/**
 * Inline images inside a message's text node are content, not chrome: providers put them in the
 * message body and never in the surrounding shell. Recording them is what keeps an image-only
 * prompt from becoming an empty message that the cardinality check would then have to reject.
 */
function readAttachments(textElement: Element): readonly Attachment[] {
  const attachments: Attachment[] = [];
  // `Array.from` rather than `for...of`: `NodeList` is only iterable under `lib.dom.iterable`,
  // which this project does not include.
  for (const image of Array.from(textElement.querySelectorAll("img[src]"))) {
    const url = image.getAttribute("src") ?? "";
    if (url === "") continue;
    const name = image.getAttribute("alt") ?? undefined;
    attachments.push(name ? { kind: "image", name, url } : { kind: "image", url });
  }
  return attachments;
}

function emptyRungs(): Record<CaptureSlot, number> {
  return { conversationRoot: -1, turnContainer: -1, messageText: -1, roleSignal: -1 };
}

/**
 * The only extraction entry point. Adapters delegate here so that the ordering rules above exist in
 * exactly one place and cannot be partially reimplemented per provider.
 */
export function extractConversation(adapter: ProviderAdapter, input: ExtractInput): ExtractResult {
  const root = input.document.documentElement;

  // 1. Landmarks. Nothing below this line runs when a landmark is missing, so no message text is
  //    read on a page whose shape is not recognised — G8.3.
  for (const landmark of adapter.landmarks) {
    if (!root.querySelector(landmark)) {
      return failure(
        "DOM_SHAPE_UNRECOGNIZED",
        `landmark ${landmark} is missing; refusing to read message text from an unrecognised page`
      );
    }
  }

  const rungs = emptyRungs();

  const resolvedRoot = resolveScope(root, adapter.ladders.conversationRoot);
  if (!resolvedRoot) {
    return failure("DOM_SHAPE_UNRECOGNIZED", "no conversation root matched the ladder", {
      slot: "conversationRoot",
    });
  }
  rungs.conversationRoot = resolvedRoot.rung;

  const resolvedTurns = resolveScope(resolvedRoot.element, adapter.ladders.turnContainer);
  if (!resolvedTurns) {
    // The root is recognised, so this is not an unrecognised *page* — it is a conversation with no
    // turns in it, which is what a still-loading skeleton looks like. The slot is still named so
    // that drift tooling can attribute it if a provider renames the container.
    return failure(
      "EMPTY_CONVERSATION",
      `no turn container matched inside the conversation root; the conversation holds no turns`,
      { slot: "turnContainer" }
    );
  }
  rungs.turnContainer = resolvedTurns.rung;

  const turnSelector = adapter.ladders.turnContainer[resolvedTurns.rung];
  const turns = Array.from(resolvedRoot.element.querySelectorAll(turnSelector));
  if (turns.length === 0) {
    // Unreachable while `resolveScope` matches with `querySelector` and reads with `querySelectorAll`
    // (they agree by construction), and kept precisely because agreeing by construction is the kind
    // of property that a later refactor breaks silently. Without it, zero turns would satisfy the
    // cardinality check and produce an empty *success* — the exact outcome G7.6 forbids.
    return failure("EMPTY_CONVERSATION", `${turnSelector} matched no turns`, {
      slot: "turnContainer",
      rung: resolvedTurns.rung,
    });
  }

  // 2. Read every turn. A turn that cannot yield a role or text is reported, never skipped.
  const messages: Message[] = [];
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];

    const role = resolveRole(turn, adapter.ladders.roleSignal);
    if (!("role" in role)) {
      return failure(role.code, `turn ${index}: ${role.error}`, {
        slot: "roleSignal",
        rung: role.rung < 0 ? undefined : role.rung,
      });
    }
    if (role.rung > rungs.roleSignal) rungs.roleSignal = role.rung;

    const text = resolveScope(turn, adapter.ladders.messageText);
    const textContent = text ? (text.element.textContent ?? "").trim() : "";
    const attachments = text ? readAttachments(text.element) : [];

    if (!text || (textContent === "" && attachments.length === 0)) {
      return failure(
        "MESSAGE_COUNT_MISMATCH",
        `turn ${index} produced no message text, so the capture would be missing a turn (${
          index + 1
        } of ${turns.length} observed)`,
        { slot: "messageText", rung: text ? text.rung : -1 }
      );
    }
    if (text.rung > rungs.messageText) rungs.messageText = text.rung;

    messages.push(
      attachments.length > 0
        ? { index, role: role.role, text: textContent, attachments }
        : { index, role: role.role, text: textContent }
    );
  }

  // 3. Cardinality. Observed turns must equal produced messages — G8.8.
  if (messages.length !== turns.length) {
    return failure(
      "MESSAGE_COUNT_MISMATCH",
      `observed ${turns.length} turn containers but produced ${messages.length} messages`
    );
  }

  const conversationUrl = canonicalConversationUrl(input.url);
  const title = (input.title ?? input.document.title ?? "").trim();

  const conversation: Conversation = title === ""
    ? { url: conversationUrl, messages }
    : { title, url: conversationUrl, messages };

  const provenance: Provenance = {
    schemaVersion: SCHEMA_VERSION,
    provider: adapter.id,
    adapterVersion: adapter.adapterVersion,
    source: CAPTURE_SOURCE,
    conversationUrl,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };

  return { ok: true, conversation, provenance, rungs: { ...rungs } };
}
