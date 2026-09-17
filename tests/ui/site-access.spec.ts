/**
 * Site access: the union predicate, the sentence, and the query — G1.10.
 *
 * The property under test is the one that made the original report possible: an install can be
 * healthy, capturing, and still be described as doing nothing, because the browser answers "may this
 * extension read this host?" two different ways and a single answer is wrong in one of the two install
 * kinds. On an unpacked build `permissions.contains` denies all six declared origins while
 * `permissions.getAll` lists all six; on a packaged build before a grant it is the reverse. So the
 * spec pins both directions, and pins the asymmetry deliberately: a query that cannot be answered
 * counts as **not allowed**, because the failure that matters is telling someone their conversations
 * are being saved when they are not.
 *
 * Only `src/ui/site-access.ts` is imported. Importing a controller module (the options page) would
 * register its `DOMContentLoaded` listener before any surface harness exists, and the harness can then
 * never remove it — the next mounted surface answers every message twice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installChromeMock } from "../helpers/chrome-mock.js";
import type { ChromeMock } from "../helpers/chrome-mock.js";
import {
  declaredOrigins,
  describeSiteAccess,
  originLabel,
  queryAllowedOrigins,
  resolveAllowed,
  ungrantedOrigins,
} from "../../src/ui/site-access.js";

const A = "https://chatgpt.com/*";
const B = "https://claude.ai/*";
const C = "https://gemini.google.com/*";
const ORIGINS = [A, B, C] as const;

/** `contained` from a per-origin map, `granted` from a list — the two browser answers. */
function contained(pairs: Record<string, boolean>): Map<string, boolean> {
  return new Map(Object.entries(pairs));
}

describe("resolveAllowed unions both browser answers — G1.10", () => {
  it("allows an origin only `contains` vouches for", () => {
    /**
     * This is the packaged-install case *after* a grant. Believing `getAll` alone here would be fine,
     * but believing `contains` alone is not — which is the next test — so both must count.
     */
    expect(resolveAllowed(ORIGINS, contained({ [A]: true }), [])).toEqual([A]);
  });

  it("allows an origin only `getAll` lists", () => {
    /**
     * The unpacked install: `contains` says no about every declared origin, `getAll` lists them all.
     * A badge or panel driven by `contains` alone would sit at `!` on a build that captures perfectly,
     * and the user would be told to grant something that is already granted.
     */
    expect(resolveAllowed(ORIGINS, contained({ [A]: false, [B]: false, [C]: false }), [A, B, C])).toEqual([
      A,
      B,
      C,
    ]);
  });

  it("refuses an origin neither answer vouches for", () => {
    expect(resolveAllowed(ORIGINS, contained({ [A]: false, [B]: false, [C]: false }), [])).toEqual([]);
  });

  it("refuses an origin the map has no answer for at all", () => {
    // A `contains` query that threw is recorded as absent or `false` by the caller. Treating "nobody
    // answered" as "yes" would turn a failed question into a grant, which is the one direction the
    // asymmetry forbids.
    expect(resolveAllowed(ORIGINS, contained({}), [])).toEqual([]);
  });

  it("answers in the manifest's order, not the browser's", () => {
    const shuffled = resolveAllowed(ORIGINS, contained({}), [C, A, B]);
    expect(shuffled).toEqual([A, B, C]);
  });

  it("ignores a granted origin this build never declared", () => {
    // A permission left over from an older version whose host has left the manifest must not appear
    // in the answer: the extension cannot read it, so counting it would overstate coverage.
    expect(resolveAllowed(ORIGINS, contained({}), [A, "https://example.com/*"])).toEqual([A]);
  });
});

describe("the site-access sentence names what is missing — G1.10", () => {
  it("says a build with no declared origins declares nothing", () => {
    const [sentence, ok] = describeSiteAccess([], []);
    expect(ok).toBe(false);
    expect(sentence).toMatch(/no optional site access/i);
  });

  it("reports full coverage as good news", () => {
    const [sentence, ok] = describeSiteAccess(ORIGINS, [...ORIGINS]);
    expect(ok).toBe(true);
    expect(sentence).toContain("3");
  });

  it("names every host when nothing is allowed, and says nothing is captured", () => {
    const [sentence, ok] = describeSiteAccess(ORIGINS, []);
    expect(ok).toBe(false);
    // The whole point: not "a setting is off" but *which* hosts are refused, and the consequence.
    expect(sentence).toContain("chatgpt.com");
    expect(sentence).toContain("claude.ai");
    expect(sentence).toContain("gemini.google.com");
    expect(sentence).toMatch(/nothing is captured/i);
  });

  it("reports a partial grant as partial, with the count and the missing hosts", () => {
    const [sentence, ok] = describeSiteAccess(ORIGINS, [A]);
    expect(ok).toBe(false);
    expect(sentence).toMatch(/1 of 3/);
    expect(sentence).toContain("claude.ai");
    expect(sentence).not.toContain("chatgpt.com");
  });

  it("does not let an undeclared granted origin inflate the count", () => {
    // Filtered against `origins` rather than counted directly: otherwise a stale grant would read as
    // "all three allowed" about a host this build cannot read.
    const [sentence, ok] = describeSiteAccess([A, B], [A, B, "https://example.com/*"]);
    expect(ok).toBe(true);
    expect(sentence).toContain("2");
  });
});

describe("originLabel is presentation only", () => {
  it("strips the scheme, the wildcard and the path", () => {
    expect(originLabel("https://chatgpt.com/*")).toBe("chatgpt.com");
    expect(originLabel("https://*.example.com/path")).toBe("example.com");
  });
});

describe("the declared origins come from the shipped manifest — G1.10", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the manifest's own list rather than a second copy", () => {
    const origins = declaredOrigins();
    // Read from disk through the mock's `getManifest`, which parses `public/manifest.json`. A literal
    // list here would let the page promise a host the packaged manifest never asks for.
    expect(origins.length).toBeGreaterThan(0);
    expect(origins).toContain("https://chatgpt.com/*");
    expect(origins.every((origin) => origin.startsWith("https://"))).toBe(true);
  });

  it("answers with nothing when the manifest does not declare the field", () => {
    mock.runtime.getManifest = (() => ({})) as unknown as ChromeMock["runtime"]["getManifest"];
    expect(declaredOrigins()).toEqual([]);
  });

  it("answers with nothing when the field is not a list of strings", () => {
    mock.runtime.getManifest = (() => ({ optional_host_permissions: "https://chatgpt.com/*" })) as unknown as ChromeMock["runtime"]["getManifest"];
    expect(declaredOrigins()).toEqual([]);
  });
});

describe("queryAllowedOrigins asks both questions and guards each — G1.10", () => {
  let mock: ChromeMock;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows everything when only `getAll` lists it", async () => {
    mock = installChromeMock({ permissions: { contains: () => false, granted: [...ORIGINS] } });
    expect(await queryAllowedOrigins(ORIGINS)).toEqual([...ORIGINS]);
  });

  it("allows what only `contains` vouches for", async () => {
    mock = installChromeMock({
      permissions: { contains: (query) => query.length > 0 && query[0] === A, granted: [] },
    });
    expect(await queryAllowedOrigins(ORIGINS)).toEqual([A]);
  });

  it("allows nothing when neither question says yes", async () => {
    mock = installChromeMock({ permissions: { contains: () => false, granted: [] } });
    expect(await queryAllowedOrigins(ORIGINS)).toEqual([]);
  });

  it("treats a `contains` that throws as a refusal, not as a grant", async () => {
    mock = installChromeMock({ permissions: { contains: () => false, granted: [] } });
    mock.permissions.contains = vi.fn(async () => {
      throw new Error("permission query unavailable");
    }) as unknown as ChromeMock["permissions"]["contains"];

    expect(await queryAllowedOrigins(ORIGINS)).toEqual([]);
  });

  it("treats a `getAll` that throws as nothing granted", async () => {
    mock = installChromeMock({ permissions: { contains: () => false, granted: [...ORIGINS] } });
    mock.permissions.getAll = vi.fn(async () => {
      throw new Error("permission query unavailable");
    }) as unknown as ChromeMock["permissions"]["getAll"];

    expect(await queryAllowedOrigins(ORIGINS)).toEqual([]);
  });
});

describe("ungrantedOrigins is what a first run has to act on — G1.11", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists every declared origin before anything is allowed", async () => {
    installChromeMock({ permissions: { contains: () => false, granted: [] } });
    expect(await ungrantedOrigins()).toEqual(declaredOrigins());
  });

  it("lists nothing once every declared origin is allowed", async () => {
    installChromeMock({ permissions: { contains: () => false, granted: declaredOrigins() } });
    expect(await ungrantedOrigins()).toEqual([]);
  });
});
