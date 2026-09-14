import { describe, expect, it } from "vitest";

import {
  CAPTURE_RECORD_TYPE,
  CAPTURE_SOURCE,
  CAPTURE_TAG,
  RESERVED_PROVENANCE_KEY,
  captureAction,
  renderTranscript,
  toCaptureProvenance,
  toEgressRecord,
} from "../../src/schema/egress.js";
import { SCHEMA_VERSION } from "../../src/schema/version.js";
import { makeConversation, makeEvent } from "../helpers/capture.js";

const PROVIDER = "chatgpt";
const ACTOR = "cortexbridge-probe";

const event = makeEvent();
const body = toEgressRecord(event, ACTOR);

describe("egress — the reserved key", () => {
  it("is a single, exact, documented key", () => {
    expect(RESERVED_PROVENANCE_KEY).toBe("hipcortex.capture");
  });

  it("is the only member of `metadata`", () => {
    expect(Object.keys(body.metadata)).toEqual([RESERVED_PROVENANCE_KEY]);
  });

  it("carries its own schemaVersion, so a reader of the object alone can version-decide", () => {
    const reserved = body.metadata[RESERVED_PROVENANCE_KEY] as Record<string, unknown>;
    expect(reserved["schemaVersion"]).toBe(SCHEMA_VERSION);
  });
});

describe("egress — discrete, filterable provider identity", () => {
  it("encodes the provider into the action the runtime filters on", () => {
    expect(captureAction(PROVIDER)).toBe(`capture:${PROVIDER}`);
    expect(body.action).toBe(`capture:${PROVIDER}`);
  });

  it("carries provider identity as a field, not only as prose in the transcript", () => {
    const reserved = body.metadata[RESERVED_PROVENANCE_KEY] as Record<string, unknown>;
    expect(reserved["provider"]).toBe(PROVIDER);
    expect(body.tags).toContain(PROVIDER);
  });

  it("uses the perception record type and the producer identity", () => {
    expect(body.record_type).toBe(CAPTURE_RECORD_TYPE);
    expect(body.record_type).toBe("Perception");
    expect(body.source).toBe(CAPTURE_SOURCE);
    expect(body.source).toBe("cortexbridge");
  });

  it("tags the capture so it is separable from hand-written memory", () => {
    expect(body.tags).toContain(CAPTURE_TAG);
  });
});

describe("egress — the provenance payload is complete and nothing more", () => {
  const reserved = body.metadata[RESERVED_PROVENANCE_KEY] as Record<string, unknown>;

  it("exposes exactly the seven discrete entries", () => {
    expect(Object.keys(reserved).sort()).toEqual(
      [
        "adapterVersion",
        "capturedAt",
        "conversationUrl",
        "eventId",
        "provider",
        "schemaVersion",
        "source",
      ].sort()
    );
  });

  it("carries the eventId at the payload level, sourced from the event and not from provenance", () => {
    expect(reserved["eventId"]).toBe(event.eventId);
    expect(Object.keys(event.provenance)).not.toContain("eventId");
  });

  it("matches the provenance it was derived from", () => {
    expect(reserved).toEqual(toCaptureProvenance(event));
  });

  it("introduces no cognitive vocabulary into the contract", () => {
    const forbidden = /belief|goal|world_model|worldview|decision|intent|importance|embedding|summary|entity/i;
    for (const key of Object.keys(reserved)) {
      expect(key).not.toMatch(forbidden);
    }
    for (const key of Object.keys(body)) {
      expect(key).not.toMatch(forbidden);
    }
  });
});

describe("egress — no TTL is ever emitted", () => {
  it("has no ttl_seconds field", () => {
    expect(Object.keys(body)).not.toContain("ttl_seconds");
  });

  it("mentions no expiry anywhere in the serialized body", () => {
    expect(JSON.stringify(body)).not.toMatch(/ttl|expires/i);
  });
});

describe("egress — the transcript", () => {
  it("renders the full transcript, both roles, in order", () => {
    const custom = toEgressRecord(
      makeEvent({
        conversation: makeConversation({
          messages: [
            { index: 0, role: "user", text: "first question" },
            { index: 1, role: "assistant", text: "first answer" },
          ],
        }),
      }),
      ACTOR
    );

    expect(custom.target).toContain("first question");
    expect(custom.target).toContain("first answer");
    expect(custom.target.indexOf("user:")).toBeLessThan(custom.target.indexOf("assistant:"));
    expect(custom.target).toContain("# A conversation");
  });

  it("is byte-identical for an unchanged conversation", () => {
    expect(renderTranscript(makeConversation())).toBe(renderTranscript(makeConversation()));
  });

  it("records an attachment that has no accompanying text", () => {
    const rendered = renderTranscript(
      makeConversation({
        messages: [
          { index: 0, role: "user", text: "", attachments: [{ kind: "image", name: "shot.png" }] },
        ],
      })
    );
    expect(rendered).toContain("user:");
    expect(rendered).toContain("[image: shot.png]");
  });

  it("falls back to a bare role line when the conversation has no title", () => {
    const rendered = renderTranscript(
      makeConversation({ title: undefined, messages: [{ index: 0, role: "user", text: "x" }] })
    );
    expect(rendered.startsWith("#")).toBe(false);
    expect(rendered).toBe("user:\nx");
  });
});

describe("egress — provenance round-trips through a provider-filtered retrieval", () => {
  interface StoredRecord {
    readonly id: string;
    readonly action: string;
    readonly record_type: string;
    readonly source: string;
    readonly target: string;
    readonly tags: readonly string[];
    readonly metadata: Record<string, unknown>;
  }

  // A store with the same provider under a *different* action, plus an unrelated action, so that a
  // filter which merely matches on the word "capture" cannot pass.
  const store: StoredRecord[] = [
    { id: "rec-1", ...toEgressRecord(makeEvent(), ACTOR) },
    {
      id: "rec-2",
      ...toEgressRecord(
        makeEvent({
          provenance: {
            schemaVersion: SCHEMA_VERSION,
            provider: "claude",
            adapterVersion: "1.0.0",
            source: "cortexbridge",
            conversationUrl: "https://claude.ai/chat/xyz",
            capturedAt: "2025-02-02T02:02:02.000Z",
          },
        }),
        ACTOR
      ),
    },
    {
      id: "rec-3",
      action: "capture-summary",
      record_type: "Semantic",
      source: "cortexbridge",
      target: "not a capture event",
      tags: ["capture"],
      metadata: {},
    },
  ];

  function providerFilteredQuery(records: readonly StoredRecord[], provider: string): StoredRecord[] {
    return records.filter((record) => record.action === captureAction(provider));
  }

  it("returns only the requested provider's captures", () => {
    const results = providerFilteredQuery(store, PROVIDER);
    expect(results.map((record) => record.id)).toEqual(["rec-1"]);
  });

  it("returns nothing for a provider with no captures", () => {
    expect(providerFilteredQuery(store, "grok")).toEqual([]);
  });

  it("restores the original provenance from the returned record", () => {
    const [record] = providerFilteredQuery(store, PROVIDER);
    expect(record).toBeDefined();
    const reserved = (record as StoredRecord).metadata[RESERVED_PROVENANCE_KEY];
    expect(reserved).toEqual(toCaptureProvenance(event));
  });

  it("keeps the two providers' provenance distinct", () => {
    const chatgpt = providerFilteredQuery(store, "chatgpt")[0];
    const claude = providerFilteredQuery(store, "claude")[0];
    const left = (chatgpt as StoredRecord).metadata[RESERVED_PROVENANCE_KEY];
    const right = (claude as StoredRecord).metadata[RESERVED_PROVENANCE_KEY];
    expect(left).not.toEqual(right);
  });
});
