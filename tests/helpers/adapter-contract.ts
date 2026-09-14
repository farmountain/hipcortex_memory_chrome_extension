/**
 * The provider adapter contract, written once and run against every adapter (tasks 7.1–7.4).
 *
 * Four provider specs that each re-state the same assertions drift apart: one gains a case the
 * others never get, and the coverage claim in `docs/END-STATE.md` becomes true of three providers
 * out of five. The assertions therefore live here, and each provider's spec file is only a
 * description of *that* provider — its adapter, its hosts, its conversation URL and the rungs its
 * fixtures are expected to select.
 *
 * Joining this suite is a contract about fixtures as well as code. A provider must ship, under
 * `tests/fixtures/<adapter.id>/`,
 *
 *   - `conversation.html`      four turns (user, assistant, user, assistant) whose texts are
 *                              `REDACTED-USER-1`, `REDACTED-ASSISTANT-1`, `REDACTED-USER-2`,
 *                              `REDACTED-ASSISTANT-2`, title `Redacted conversation`, and whose
 *                              slots resolve at the rung each provider declares below.
 *   - `rung-1.html`            the same four turns with every slot forced to rung 1.
 *   - `rung-messageText-0.html` the same four turns with every `messageText` slot forced to rung 0,
 *                              which is otherwise unreachable because the reported rung is the
 *                              deepest one used (a canonical conversation reads the assistant text at
 *                              rung 0 and the user text at rung 1).
 *   - `unknown-shape.html`     a readable conversation behind a missing *first* landmark, containing
 *                              the marker `MARKER-MUST-NOT-BE-READ`.
 *   - `no-turns.html`          a recognised shell whose conversation root holds no turns.
 *   - `no-role.html`           readable turns that carry no role signal at all.
 *   - `partial.html`           four turn containers, the third with empty text.
 *   - `unsupported-role.html`  turns whose role attribute holds a token the alias table rejects.
 *
 * The fixtures are shaped to the declared ladders; they are not recordings of the live pages. What
 * these cases prove is the *failure mode* — that an unrecognised page refuses loudly rather than
 * producing a plausible wrong capture, which is the only property that survives a provider shipping
 * a rename tomorrow.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { expectExtractFailure, expectExtractSuccess } from "./extract.js";
import { parseFixture, readFixture } from "./fixtures.js";
import { CAPTURE_SLOTS, EXTRACT_ERROR_CODES } from "../../src/capture/providers/types.js";
import type {
  CaptureSlot,
  ExtractResult,
  ProviderAdapter,
} from "../../src/capture/providers/types.js";
import { CAPTURE_SOURCE, isUtcTimestamp, SCHEMA_VERSION } from "../../src/schema/index.js";

/** Fixture names every provider joining this suite must ship. */
const FIXTURES = {
  canonical: "conversation.html",
  deepRungs: "rung-1.html",
  firstRungTexts: "rung-messageText-0.html",
  unknownShape: "unknown-shape.html",
  noTurns: "no-turns.html",
  noRole: "no-role.html",
  partial: "partial.html",
  unsupportedRole: "unsupported-role.html",
} as const;

/** The marker a fixture hides behind a missing landmark. */
const UNREAD_MARKER = "MARKER-MUST-NOT-BE-READ";

/** The rungs `rung-1.html` must select: every slot forced one rung deeper. */
const DEEP_RUNGS: Readonly<Record<CaptureSlot, number>> = {
  conversationRoot: 1,
  turnContainer: 1,
  messageText: 1,
  roleSignal: 1,
};

/** The rungs `rung-messageText-0.html` must select: every text read at the first rung. */
const FIRST_RUNG_TEXTS: Readonly<Record<CaptureSlot, number>> = {
  conversationRoot: 0,
  turnContainer: 0,
  messageText: 0,
  roleSignal: 0,
};

/** The canonical conversation every provider's `conversation.html` must contain. */
const CANONICAL_ROLES = ["user", "assistant", "user", "assistant"];
const CANONICAL_TEXTS = [
  "REDACTED-USER-1",
  "REDACTED-ASSISTANT-1",
  "REDACTED-USER-2",
  "REDACTED-ASSISTANT-2",
];

export interface AdapterContract {
  readonly adapter: ProviderAdapter;
  /** Every host the adapter claims, as declared by the adapter module. */
  readonly hosts: readonly string[];
  /** The provider's canonical conversation URL. */
  readonly conversationUrl: string;
  /** The path part of `conversationUrl`, used to build subdomain and shell URLs. */
  readonly conversationPath: string;
  /** The rungs `conversation.html` is expected to select. */
  readonly canonicalRungs: Readonly<Record<CaptureSlot, number>>;
  /** URLs that share part of a declared host — or nothing at all — and must never match. */
  readonly nonMatchingUrls: readonly string[];
}

export function describeAdapterContract(contract: AdapterContract): void {
  const { adapter } = contract;
  const provider = adapter.id;

  function extractFixture(name: string, url = contract.conversationUrl, capturedAt?: string): ExtractResult {
    const document = parseFixture(readFixture(provider, name));
    return adapter.extract({ document, url, capturedAt });
  }

  const CASES: ReadonlyArray<{ fixture: string; expected: Readonly<Record<CaptureSlot, number>> }> = [
    { fixture: FIXTURES.canonical, expected: contract.canonicalRungs },
    { fixture: FIXTURES.deepRungs, expected: DEEP_RUNGS },
    { fixture: FIXTURES.firstRungTexts, expected: FIRST_RUNG_TEXTS },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe(`${adapter.displayName} adapter identity`, () => {
    it("declares the provenance fields the contract requires", () => {
      expect(adapter.id).toBe(provider);
      expect(adapter.displayName.length).toBeGreaterThan(0);
      expect(adapter.adapterVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(adapter.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(isUtcTimestamp(`${adapter.verifiedAt}T00:00:00.000Z`)).toBe(true);
    });

    it("verifies no date in the future — G8.1", () => {
      // A future date would let an unverified selector ladder claim to be verified.
      expect(new Date(`${adapter.verifiedAt}T00:00:00.000Z`).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("declares at least one landmark and an ordered ladder for every slot", () => {
      expect(adapter.landmarks.length).toBeGreaterThan(0);
      for (const slot of CAPTURE_SLOTS) {
        expect(adapter.ladders[slot].length, slot).toBeGreaterThan(1);
      }
    });
  });

  describe(`${adapter.displayName} URL matching — G1.2`, () => {
    it("matches each declared host on a conversation path", () => {
      for (const host of contract.hosts) {
        expect(adapter.matches(`https://${host}${contract.conversationPath}`), host).toBe(true);
      }
    });

    it("matches a subdomain of a declared host", () => {
      for (const host of contract.hosts) {
        expect(adapter.matches(`https://www.${host}${contract.conversationPath}`), host).toBe(true);
      }
    });

    it("does not match an unrelated host", () => {
      expect(adapter.matches("https://example.com/chat")).toBe(false);
    });

    it("does not match a declared host without a conversation path", () => {
      // The app shell and the settings pages are not conversations, and capturing them would produce
      // an empty conversation from a page that merely shares the hostname.
      for (const host of contract.hosts) {
        expect(adapter.matches(`https://${host}/`), host).toBe(false);
        expect(adapter.matches(`https://${host}/settings`), host).toBe(false);
      }
    });

    it("does not match a lookalike host or a non-http scheme", () => {
      for (const url of contract.nonMatchingUrls) {
        expect(adapter.matches(url), url).toBe(false);
      }
      for (const host of contract.hosts) {
        expect(adapter.matches(`ftp://${host}${contract.conversationPath}`), host).toBe(false);
      }
    });

    it("does not throw on an unparseable URL", () => {
      expect(adapter.matches("not a url")).toBe(false);
    });
  });

  describe(`${adapter.displayName} extraction — G1.3, G1.5`, () => {
    it("extracts every turn in order with its role preserved", () => {
      const success = expectExtractSuccess(extractFixture(FIXTURES.canonical));

      expect(success.conversation.messages.map((message) => message.role)).toEqual(CANONICAL_ROLES);
      expect(success.conversation.messages.map((message) => message.text)).toEqual(CANONICAL_TEXTS);
      expect(success.conversation.messages.map((message) => message.index)).toEqual([0, 1, 2, 3]);
      expect(success.conversation.title).toBe("Redacted conversation");
    });

    it("builds provenance that names the adapter that produced it — G1.5", () => {
      const success = expectExtractSuccess(extractFixture(FIXTURES.canonical));

      expect(success.provenance.provider).toBe(adapter.id);
      expect(success.provenance.adapterVersion).toBe(adapter.adapterVersion);
      expect(success.provenance.source).toBe(CAPTURE_SOURCE);
      expect(success.provenance.schemaVersion).toBe(SCHEMA_VERSION);
      expect(success.provenance.conversationUrl).toBe(contract.conversationUrl);
      expect(isUtcTimestamp(success.provenance.capturedAt)).toBe(true);
      expect(Object.keys(success.provenance).sort()).toEqual([
        "adapterVersion",
        "capturedAt",
        "conversationUrl",
        "provider",
        "schemaVersion",
        "source",
      ]);
    });

    it("honours an injected capture time", () => {
      const capturedAt = "2025-01-15T12:00:00.000Z";
      const success = expectExtractSuccess(
        extractFixture(FIXTURES.canonical, contract.conversationUrl, capturedAt)
      );
      expect(success.provenance.capturedAt).toBe(capturedAt);
    });

    it("canonicalises the conversation URL by dropping query and fragment", () => {
      const success = expectExtractSuccess(
        extractFixture(FIXTURES.canonical, `${contract.conversationUrl}?model=x#latest`)
      );

      expect(success.conversation.url).toBe(contract.conversationUrl);
      expect(success.provenance.conversationUrl).toBe(contract.conversationUrl);
    });
  });

  describe(`${adapter.displayName} ladder rungs — G8.2, G8.5`, () => {
    for (const { fixture, expected } of CASES) {
      it(`reports the rung that satisfied each slot for ${fixture} — G8.2`, () => {
        const success = expectExtractSuccess(extractFixture(fixture));

        expect(success.rungs).toEqual(expected);
        expect(success.conversation.messages.length).toBeGreaterThanOrEqual(3);
        expect(
          new Set(success.conversation.messages.map((message) => message.role)).size
        ).toBeGreaterThanOrEqual(2);
      });
    }

    it("has at least one fixture selecting every declared rung of every slot — G8.5", () => {
      // Derived from the same table the cases above assert on, so adding a rung to an adapter ladder
      // fails here until a fixture is added that reaches it.
      for (const slot of CAPTURE_SLOTS) {
        const covered = new Set(CASES.map((testCase) => testCase.expected[slot]));
        const declared = adapter.ladders[slot].map((_selector, index) => index);
        expect([...covered].sort((a, b) => a - b), slot).toEqual(declared);
      }
    });
  });

  describe(`${adapter.displayName} typed failures — G1.4, G7.6, G8.3, G8.7`, () => {
    it("returns DOM_SHAPE_UNRECOGNIZED when a landmark is missing — G8.3", () => {
      const failure = expectExtractFailure(extractFixture(FIXTURES.unknownShape));

      expect(failure.code).toBe("DOM_SHAPE_UNRECOGNIZED");
      expect(EXTRACT_ERROR_CODES).toContain(failure.code);
      expect(failure.detail).toContain(adapter.landmarks[0]);
    });

    it("reads no message text before deciding the shape is unrecognised — G8.3", () => {
      const document = parseFixture(readFixture(provider, FIXTURES.unknownShape));
      // The fixture contains readable text behind a valid turn container, so a capture that skipped
      // the landmark gate would succeed here rather than fail — this asserts the gate runs first.
      expect(document.documentElement.textContent).toContain(UNREAD_MARKER);

      const reads = vi.spyOn(Node.prototype, "textContent", "get");
      const failure = expectExtractFailure(
        adapter.extract({ document, url: contract.conversationUrl })
      );

      expect(failure.code).toBe("DOM_SHAPE_UNRECOGNIZED");
      expect(reads).not.toHaveBeenCalled();
    });

    it("does read message text on the canonical fixture, so the probe above is not vacuous", () => {
      const document = parseFixture(readFixture(provider, FIXTURES.canonical));
      const reads = vi.spyOn(Node.prototype, "textContent", "get");

      expectExtractSuccess(adapter.extract({ document, url: contract.conversationUrl }));
      expect(reads.mock.calls.length).toBeGreaterThan(0);
    });

    it("returns EMPTY_CONVERSATION for a recognised shell holding no turns — G7.6", () => {
      const failure = expectExtractFailure(extractFixture(FIXTURES.noTurns));

      expect(failure.code).toBe("EMPTY_CONVERSATION");
      expect(failure.slot).toBe("turnContainer");
      expect(failure).not.toHaveProperty("conversation");
    });

    it("returns NO_ROLE_SIGNAL rather than assuming roles alternate — G1.4", () => {
      const failure = expectExtractFailure(extractFixture(FIXTURES.noRole));

      expect(failure.code).toBe("NO_ROLE_SIGNAL");
      expect(failure).not.toHaveProperty("conversation");
    });

    it("returns UNSUPPORTED_LAYOUT for a role token it cannot map — G1.4", () => {
      const failure = expectExtractFailure(extractFixture(FIXTURES.unsupportedRole));

      expect(failure.code).toBe("UNSUPPORTED_LAYOUT");
      expect(failure.slot).toBe("roleSignal");
    });

    it("never returns a partially-populated conversation — G8.7", () => {
      const failure = expectExtractFailure(extractFixture(FIXTURES.partial));

      // Four turn containers, three readable texts: reporting three messages would look like a
      // successful capture and the missing turn would be undetectable downstream.
      expect(failure.code).toBe("MESSAGE_COUNT_MISMATCH");
      expect(failure.detail).toContain("4");
      expect(failure).not.toHaveProperty("conversation");
    });

    it("emits only codes the error union declares", () => {
      for (const fixture of [
        FIXTURES.unknownShape,
        FIXTURES.noTurns,
        FIXTURES.noRole,
        FIXTURES.partial,
      ]) {
        const failure = expectExtractFailure(extractFixture(fixture));
        expect(EXTRACT_ERROR_CODES, fixture).toContain(failure.code);
      }
    });
  });

  describe(`${adapter.displayName} extraction purity — G1.6`, () => {
    it("mutates nothing in the page it reads", () => {
      const document = parseFixture(readFixture(provider, FIXTURES.canonical));
      const before = document.documentElement.outerHTML;

      expectExtractSuccess(adapter.extract({ document, url: contract.conversationUrl }));

      expect(document.documentElement.outerHTML).toBe(before);
    });

    it("mutates nothing when it fails", () => {
      const document = parseFixture(readFixture(provider, FIXTURES.unknownShape));
      const before = document.documentElement.outerHTML;

      expectExtractFailure(adapter.extract({ document, url: contract.conversationUrl }));

      expect(document.documentElement.outerHTML).toBe(before);
    });
  });
}
