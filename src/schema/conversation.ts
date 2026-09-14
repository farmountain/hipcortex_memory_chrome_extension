/**
 * The conversation payload — versioned, provider-agnostic, and deliberately small.
 *
 * Note what is *not* here: no decision, belief, goal, entity, summary, embedding or importance
 * score. Those are the core's surfaces (`docs/ARCHITECTURE.md`), and a capture contract that grows
 * a cognitive field has quietly moved distillation into the perception layer. This shape is the
 * structural envelope and nothing else — G5.1.
 */

export const MESSAGE_ROLES = ["user", "assistant", "system", "tool"] as const;

export type MessageRole = (typeof MESSAGE_ROLES)[number];

/**
 * Attachments are recorded so that an image-only prompt is not an empty capture. This is the one
 * place the contract admits non-text content, and it is why validation treats
 * "text or attachments" as the content rule rather than "non-empty text".
 */
export interface Attachment {
  readonly kind: "image" | "file" | "link";
  readonly name?: string;
  readonly url?: string;
}

export interface Message {
  /**
   * Zero-based and **contiguous**: message `n` has `index === n`. A provider that exposes a stable
   * per-turn id is not allowed to leak it here, because that would make the contract depend on
   * provider internals.
   */
  readonly index: number;
  readonly role: MessageRole;
  readonly text: string;
  readonly attachments?: readonly Attachment[];
  /** ISO-8601 UTC with a `Z` suffix, when the provider exposes a timestamp. */
  readonly capturedMessageAt?: string;
}

export interface Conversation {
  readonly title?: string;
  /** Canonical conversation URL. Also carried in provenance, and validated to match it. */
  readonly url: string;
  readonly messages: readonly Message[];
}
