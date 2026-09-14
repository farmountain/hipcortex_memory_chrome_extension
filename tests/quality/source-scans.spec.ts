import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SRC_DIR, findViolations, pathsWith, scanSource, toRepoRelative } from "../helpers/scan.js";

/**
 * Task 1.7 — prove the scanner itself is trustworthy before any gate relies on it.
 *
 * The enumeration below is written independently of `walk()` in the helper on purpose. If the spec
 * called the helper to compute its own expectation, the first case would be a tautology and every
 * later "appears nowhere under `src/`" gate would inherit the blind spot.
 */
function allFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...allFilesUnder(full));
    else found.push(toRepoRelative(full));
  }
  return found.sort();
}

describe("scanSource()", () => {
  it("enumerates every file under src/, including nested directories", () => {
    const expected = allFilesUnder(SRC_DIR);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected).toContain("src/types/index.ts");
    expect(expected).toContain("src/api/transport/http.ts");
    expect(scanSource().map((file) => file.path).sort()).toEqual(expected);
  });

  it("returns the content of each file, not just its path", () => {
    for (const file of scanSource()) {
      expect(file.content.length, `${file.path} should not be empty`).toBeGreaterThan(0);
    }
  });

  it("reports a violation with its path, line number and matched text", () => {
    const files = [{ path: "src/example.ts", content: "const ok = 1;\nconst bad = 2;\n" }];
    expect(findViolations(files, /bad/)).toEqual([
      { path: "src/example.ts", line: 2, text: "const bad = 2;" },
    ]);
  });

  it("reports nothing when the pattern does not match", () => {
    const files = [{ path: "src/example.ts", content: "const ok = 1;\n" }];
    expect(findViolations(files, /definitely-not-present/)).toEqual([]);
  });
});

/**
 * Tasks 4.15 and 4.19 — the network and retrieval surfaces are contained.
 *
 * Both cases assert the positive location as well as the absence. An "appears nowhere else" check
 * with no check that it appears *somewhere* passes trivially after a rename, which would leave the
 * gate green and the containment unproven.
 */
describe("network surface containment", () => {
  it("keeps the only network call in src/api/transport/http.ts", () => {
    const callers = findViolations(scanSource(), /\bfetch\s*\(/).map((violation) => violation.path);
    expect([...new Set(callers)]).toEqual(["src/api/transport/http.ts"]);
  });

  it("keeps Native Messaging in src/api/transport/native.ts only", () => {
    const callers = findViolations(scanSource(), /chrome\.runtime\.connectNative\s*\(/).map(
      (violation) => violation.path
    );
    expect([...new Set(callers)]).toEqual(["src/api/transport/native.ts"]);
  });

  it("does not use the flat search endpoint on any read path", () => {
    expect(findViolations(scanSource(), /memory\/search-flat/)).toEqual([]);
  });
});

/**
 * Task 5.13 — the router and the transport layer know nothing about providers.
 *
 * This is G1.8 stated as a scan rather than a convention. The value of putting DOM knowledge here
 * is not tidiness: a selector in the router would be a second, unreviewed place for a provider's
 * shape to leak, and it would drift from the adapter without any drift record naming a provider.
 *
 * Both cases add a positive control, because an absence check with no evidence that the pattern can
 * match at all passes trivially — including after the pattern has been misspelled.
 */
describe("provider containment — G1.8", () => {
  const PROVIDER_SURFACE = /chatgpt|openai|anthropic|claude|gemini|grok|deepseek/i;
  const SELECTOR_SURFACE =
    /data-testid|data-message-author-role|data-author-role|data-turn|querySelector|\.markdown|whitespace-pre-wrap/;

  function routerAndTransport() {
    return scanSource().filter(
      (file) => file.path === "src/background.ts" || file.path.startsWith("src/api/")
    );
  }

  function perceptionLayer() {
    const files = scanSource().filter((file) => file.path.startsWith("src/capture/"));
    expect(files.length).toBeGreaterThan(0);
    return files;
  }

  it("has no provider name in the router or the transport layer", () => {
    expect(findViolations(routerAndTransport(), PROVIDER_SURFACE)).toEqual([]);
  });

  it("has no provider selector in the router or the transport layer", () => {
    expect(findViolations(routerAndTransport(), SELECTOR_SURFACE)).toEqual([]);
  });

  it("finds both patterns inside the perception layer", () => {
    expect(findViolations(perceptionLayer(), PROVIDER_SURFACE).length).toBeGreaterThan(0);
    expect(findViolations(perceptionLayer(), SELECTOR_SURFACE).length).toBeGreaterThan(0);
  });
});

/**
 * Task 5.14 — adapter configuration is code, never data.
 *
 * G8.4 forbids fetching or storing a selector ladder. The reason is the same one that makes the
 * ladders code-only in the first place: configuration that arrives at runtime can be changed by
 * something other than a reviewed commit, and a silently altered selector ladder produces wrong
 * captures rather than failures.
 */
describe("adapter configuration is inert — G8.4", () => {
  function perceptionLayer() {
    return scanSource().filter((file) => file.path.startsWith("src/capture/"));
  }

  /** The tree that actually holds selectors, landmarks and ladders. */
  function configurationLayer() {
    const files = scanSource().filter((file) => file.path.startsWith("src/capture/providers/"));
    expect(files.length).toBeGreaterThan(0);
    return files;
  }

  it("never fetches selectors, landmarks or adapter configuration", () => {
    expect(findViolations(perceptionLayer(), /\bfetch\s*\(|XMLHttpRequest|connectNative/)).toEqual([]);
  });

  it("never reads adapter configuration from extension storage", () => {
    // G8.4 names selectors, landmarks and adapter *configuration*. The adapter tree is where those
    // live, so the blanket rule holds there unchanged — and the positive control above proves that
    // this file set and these patterns can match at all.
    expect(findViolations(configurationLayer(), /chrome\.storage|chrome\.runtime\.getURL/)).toEqual([]);
  });

  it("never reads anything configuration-shaped from storage anywhere in the perception layer", () => {
    // Group 6 persists three things under `src/capture/`: the undelivered queue (G2.3, G2.6 — a
    // backlog that does not survive worker eviction is not a backlog), the failure log and the
    // drift counter. None of those is configuration, and none of them may become one, so the rule
    // is applied to what a storage line may be *about* rather than to the call itself. A storage
    // line that names a selector, ladder, rung, landmark or adapter is the regression this
    // criterion forbids: a ladder that arrives at runtime can be changed by something other than a
    // reviewed commit, and a silently altered ladder produces wrong captures rather than failures.
    const storageLines = findViolations(perceptionLayer(), /chrome\.storage/);
    expect(storageLines.length).toBeGreaterThan(0); // positive control: the pattern matches here
    expect(
      storageLines.filter((violation) => /selector|ladder|rung|landmark|adapter|config/i.test(violation.text))
    ).toEqual([]);
    expect(findViolations(perceptionLayer(), /chrome\.runtime\.getURL/)).toEqual([]);
  });

  it("never loads adapter configuration dynamically", () => {
    expect(findViolations(perceptionLayer(), /(?<![.\w])import\s*\(|(?<![.\w])require\s*\(/)).toEqual([]);
  });

  it("proves those patterns match elsewhere in src/", () => {
    const elsewhere = scanSource().filter((file) => !file.path.startsWith("src/capture/"));
    expect(findViolations(elsewhere, /chrome\.storage/).length).toBeGreaterThan(0);
  });
});

/**
 * Task 9.8 — no cognitive reasoning is implemented in the extension (G5.4).
 *
 * The boundary in `AGENTS.md` is that CortexBridge perceives and the core reasons. The exempt trees
 * are the two that *describe* the contract: `src/schema/**` defines the envelope, and `src/types/**`
 * defines the message types, so both legitimately name the cognitive fields the envelope must not
 * contain.
 *
 * The rule is applied to **code positions**, not to prose. A comment that says "there is no belief
 * here" is the boundary being documented; an identifier, literal or call named `beliefs` is the
 * boundary being crossed. Prose is excluded by dropping comment lines, and the exclusion is only
 * applied outside the exempt trees so the pattern still has to be shown to match something.
 */
describe("no cognitive reasoning in the perception layer — G5.4", () => {
  const COGNITIVE =
    /\b(beliefs?|world_?model|worldview|consolidat\w*|embeddings?|salience|sentiment|goals?|summar\w*|importance|infer\w*)\b/;

  function outsideContract() {
    return scanSource().filter(
      (file) => !file.path.startsWith("src/schema/") && !file.path.startsWith("src/types/")
    );
  }

  function codeViolations(files: ReturnType<typeof scanSource>) {
    return findViolations(files, COGNITIVE).filter(
      (violation) => !/^(\*|\/\/|\/\*)/.test(violation.text)
    );
  }

  it("has no cognitive vocabulary in a code position", () => {
    const files = outsideContract();
    expect(files.length).toBeGreaterThan(0);
    expect(codeViolations(files)).toEqual([]);
  });

  it("still finds the vocabulary where it is legitimate, so the pattern is not misspelled", () => {
    const contract = scanSource().filter(
      (file) => file.path.startsWith("src/schema/") || file.path.startsWith("src/types/")
    );
    expect(findViolations(contract, COGNITIVE).length).toBeGreaterThan(0);

    // And the boundary is documented in prose elsewhere, which is why prose had to be excluded
    // rather than the vocabulary being absent from the repository.
    expect(findViolations(outsideContract(), COGNITIVE).length).toBeGreaterThan(0);
  });

  it("derives no interpretation from a conversation", () => {
    const derived = codeViolations(outsideContract());
    expect(derived.filter((violation) => /conversation|transcript|message/i.test(violation.text))).toEqual([]);
  });
});

/**
 * Task 2.1 — the queue is transport, not memory (G2.1).
 *
 * The queue exists so that an accepted capture survives a worker eviction until the runtime confirms
 * it (G2.2, G2.6). It is not a place to look a conversation up in, and the difference is load-
 * bearing rather than stylistic: the moment another module reads individual entries, the extension
 * has two claims about what was captured — the one the core retained and the one this queue is
 * holding — and no rule about which wins. The rule below is therefore about *reaching* an entry, not
 * about calling the queue: measuring the backlog is how the status surface reports it, and that is
 * the one use outside the queue.
 */
describe("the queue is transport, not memory — G2.1", () => {
  const QUEUE_DIR = "src/capture/queue/";

  /** The one tree allowed to know what a queued entry looks like. */
  function queueTree() {
    const files = scanSource().filter((file) => file.path.startsWith(QUEUE_DIR));
    expect(files.length).toBeGreaterThan(0);
    return files;
  }

  function outsideQueue() {
    const files = scanSource().filter((file) => !file.path.startsWith(QUEUE_DIR));
    expect(files.length).toBeGreaterThan(0);
    return files;
  }

  /** `.entries` is the only way to reach an entry; `Object.entries` is not that property. */
  const REACHES_AN_ENTRY = /(?<!Object)\.entries(?!\.length\b)/;

  /** The "code position, not prose" rule the cognitive scan uses, applied to one file set. */
  function codeViolations(files: ReturnType<typeof scanSource>, pattern: RegExp) {
    return findViolations(files, pattern).filter((violation) => !/^(\*|\/\/|\/\*)/.test(violation.text));
  }

  it("has no reader of a queued entry outside the queue", () => {
    expect(findViolations(outsideQueue(), REACHES_AN_ENTRY)).toEqual([]);
  });

  it("still reaches entries inside the queue, so the rule is about a real capability", () => {
    expect(findViolations(queueTree(), REACHES_AN_ENTRY).length).toBeGreaterThan(0);
  });

  it("would notice an entry reader, so the absence is meaningful", () => {
    const synthetic = [
      { path: "src/synthetic.ts", content: "const first = state.entries[0];" },
      { path: "src/synthetic.ts", content: "state.entries.filter((entry) => entry.attempts > 3);" },
      { path: "src/synthetic.ts", content: "for (const entry of state.entries) send(entry.event);" },
    ];
    expect(findViolations(synthetic, REACHES_AN_ENTRY)).toHaveLength(3);
    // And measuring the backlog is not a violation, or the one legitimate use would be reported.
    expect(findViolations([{ path: "src/synthetic.ts", content: "state.entries.length" }], REACHES_AN_ENTRY)).toEqual([]);
    expect(findViolations([{ path: "src/synthetic.ts", content: "Object.entries(value)" }], REACHES_AN_ENTRY)).toEqual([]);
  });

  it("names no queued-entry bookkeeping or verdict in a code position outside the queue", () => {
    // `nextAttemptAt` and `enqueuedAt` are retry mechanics; `refusalReason` and `markAttempt` are a
    // verdict about one capture. A module outside the queue that names one of them in code is
    // deriving meaning from a waiting entry instead of forwarding it. Prose is excluded for the same
    // reason the cognitive scan excludes it: a comment that explains the field is the contract being
    // documented, and the boundary is crossed by reading it, not by mentioning it.
    const BOOKKEEPING = /nextAttemptAt|\.enqueuedAt\b|\.refusalReason\b|\bmarkAttempt\b/;
    expect(codeViolations(outsideQueue(), BOOKKEEPING)).toEqual([]);

    // Positive control: the queue itself names every one of those, in code, so the absence above is
    // about this rule and not about a misspelled pattern.
    const inside = codeViolations(queueTree(), BOOKKEEPING);
    for (const field of ["nextAttemptAt", "enqueuedAt", "refusalReason", "markAttempt"]) {
      expect(inside.some((violation) => violation.text.includes(field)), `the queue should name ${field}`).toBe(
        true
      );
    }
  });

  it("does not search, match or rank a waiting entry", () => {
    expect(
      findViolations(outsideQueue(), /\b(query|search|match|rank|score|sort)\w*\(\s*[^)]*\.entries\b/)
    ).toEqual([]);
  });
});

/**
 * Task 2.3 — "retention" cannot drift into "recollection" (G2.1, G5.4).
 *
 * The blanket cognitive-vocabulary rule above already covers these files, so this is a narrower rule
 * over the paths that decide what happens to an undelivered capture. It exists because the pair of
 * words is where the boundary would be lost first: `retained` describes a capture that has not been
 * delivered yet and can still leave, while `remembered` or `recalled` would claim this extension can
 * bring one back — which is the core's job. A rename in either direction is a scope change, so the
 * vocabulary that would carry it is what gets scanned.
 */
describe("retention is not recollection — G2.1 (task 2.3)", () => {
  const RECOLLECTION =
    /\b(remembers?|remembered|remembering|recalls?|recalled|recalling|recollect\w*|forgets?|forgotten|memoriz\w*|memoris\w*)\b/;

  const RETENTION = /\bretain\w*\b|\bretention\w*\b/i;

  /** The paths that decide whether an undelivered capture is kept, retried or reported. */
  function retentionPaths() {
    const files = scanSource().filter(
      (file) =>
        file.path.startsWith("src/capture/queue/") ||
        file.path === "src/capture/pipeline.ts" ||
        file.path === "src/capture/failures.ts" ||
        file.path === "src/capture/lifecycle.ts" ||
        file.path === "src/background.ts"
    );
    expect(files.length).toBeGreaterThan(0);
    return files;
  }

  it("describes a waiting capture with retention vocabulary", () => {
    expect(findViolations(retentionPaths(), RETENTION).length).toBeGreaterThan(0);
  });

  it("uses no recollection vocabulary in a code position on those paths", () => {
    const offenders = findViolations(retentionPaths(), RECOLLECTION).filter(
      (violation) => !/^(\*|\/\/|\/\*)/.test(violation.text)
    );
    expect(offenders).toEqual([]);
  });

  it("would catch recollection vocabulary if it arrived, so the absence means something", () => {
    const synthetic = [
      {
        path: "src/capture/queue/synthetic.ts",
        content: "const remembered = recall(entry);\nforget(remembered);\n",
      },
    ];
    expect(findViolations(synthetic, RECOLLECTION)).toHaveLength(2);
    // And the retention vocabulary is not caught by it, or the two rules would contradict.
    expect(findViolations(synthetic, RETENTION)).toEqual([]);
  });
});

/**
 * Task 9.9 — the silent-failure endpoint appears nowhere in production (G5.5).
 *
 * The endpoint returns HTTP 200 and discards the payload. That is why it is checked here as well as
 * in the contract specs: it must be absent from the whole `src/` tree, comments included, because a
 * comment naming it would be the first step towards a call site.
 */
describe("the silent-failure endpoint is absent — G5.5", () => {
  const FORBIDDEN = new RegExp(`memory/${"ingest"}`);

  it("appears nowhere under src/, comments included", () => {
    const files = scanSource();
    expect(files.length).toBeGreaterThan(0);
    expect(findViolations(files, FORBIDDEN)).toEqual([]);
  });

  it("would notice the path if a source contained it, so the absence is meaningful", () => {
    const synthetic = [{ path: "src/synthetic.ts", content: `await post("/memory/${"ingest"}");` }];
    expect(findViolations(synthetic, FORBIDDEN)).toHaveLength(1);
  });
});

/**
 * Task 9.10 — conversation content never reaches sync storage (G2.7).
 *
 * `chrome.storage.sync` is copied to every signed-in browser profile and travels through Google's
 * servers. Settings belong there; a captured transcript does not. The behavioural proof is in
 * `tests/capture/queue.spec.ts`, `failures.spec.ts` and `pipeline.spec.ts`; this is the static
 * proof that no call site exists which could ever carry one.
 */
describe("conversation content never reaches sync storage — G2.7", () => {
  const SYNC = /chrome\.storage\.sync/;
  const CONTENT = /conversation|transcript|messages|target|event|payload|content/i;

  it("uses sync storage, so the checks below are about real call sites", () => {
    expect(findViolations(scanSource(), SYNC).length).toBeGreaterThan(0);
  });

  it("keeps every sync access in the settings path, never in the perception layer", () => {
    const files = findViolations(scanSource(), SYNC).map((violation) => violation.path);
    expect([...new Set(files)].sort()).toEqual(["src/background.ts"]);
  });

  it("passes no conversation-shaped value to a sync call", () => {
    const offenders = findViolations(scanSource(), SYNC).filter((violation) =>
      CONTENT.test(violation.text)
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * Task 2.1 — the local search index is lexical and stays lexical (G5.4).
 *
 * The blanket cognitive-vocabulary rule above already covers `src/index/**`, so what this adds is the
 * rule stated over the tree that could break it most plausibly. A local index of captured
 * conversations is exactly the shape that invites a second capability: similarity, relevance,
 * ranking, clustering, a summary of what was found. Every one of those is the core's job, and each of
 * them would make the offline path a second, disagreeing answer to the same query rather than a
 * narrower copy of the same answer. So the vocabulary that would carry the change is scanned for, in
 * code positions only — the prose in these files documents the absence deliberately, and a comment
 * that says "no similarity score here" is the boundary being written down.
 */
describe("the search index is lexical, never semantic — G5.4 (task 2.1)", () => {
  const INDEX_DIR = "src/index/";

  /** The same vocabulary the blanket rule uses, so the two rules cannot drift apart. */
  const COGNITIVE =
    /\b(beliefs?|world_?model|worldview|consolidat\w*|embeddings?|salience|sentiment|goals?|summar\w*|importance|infer\w*)\b/;

  /** The second capability, named: ranking the results of a local lookup. */
  const SEMANTIC = /\b(similar\w*|cosine|relevance|bm25|tfidf|tf_idf|cluster\w*|semantic\w*|rank\w*|scoring)\b/i;

  function indexTree() {
    const files = scanSource().filter((file) => file.path.startsWith(INDEX_DIR));
    expect(files.length).toBeGreaterThan(0);
    return files;
  }

  function codeViolations(files: ReturnType<typeof scanSource>, pattern: RegExp) {
    return findViolations(files, pattern).filter((violation) => !/^(\*|\/\/|\/\*)/.test(violation.text));
  }

  it("names no cognitive vocabulary in a code position", () => {
    expect(codeViolations(indexTree(), COGNITIVE)).toEqual([]);
  });

  it("names no similarity, ranking or clustering vocabulary in a code position", () => {
    expect(codeViolations(indexTree(), SEMANTIC)).toEqual([]);
  });

  it("still finds the vocabulary where it is legitimate, so neither pattern is misspelled", () => {
    const contract = scanSource().filter(
      (file) => file.path.startsWith("src/schema/") || file.path.startsWith("src/types/")
    );
    expect(findViolations(contract, COGNITIVE).length).toBeGreaterThan(0);

    // A ranking term is legitimate where the runtime's own answer is described, so the pattern is
    // shown to match real code rather than nothing at all.
    expect(findViolations(scanSource(), SEMANTIC).length).toBeGreaterThan(0);
  });

  it("would notice a similarity score arriving in the index, so the absence means something", () => {
    const synthetic = [
      { path: "src/index/synthetic.ts", content: "const score = similarity(a, b);" },
      { path: "src/index/synthetic.ts", content: "hits.sort((x, y) => y.relevance - x.relevance);" },
    ];
    expect(findViolations(synthetic, SEMANTIC)).toHaveLength(2);
  });
});

/**
 * Task 2.2 — the offline query path contains no transport call at all (G3.9).
 *
 * "Search your captured conversations with the runtime stopped" is only true if the path that answers
 * it cannot reach the network even by mistake. The proof is not that a live runtime was up and
 * unused; it is that the module has no expression capable of a request, no transport import and no
 * message channel to borrow one from. `fetch(` is permitted in exactly one file —
 * `src/api/transport/http.ts` — and the positive controls below hold that fact down from both sides.
 */
describe("the offline search path cannot reach the network — G3.9 (task 2.2)", () => {
  const INDEX_DIR = "src/index/";
  const NETWORK = /\bfetch\s*\(|XMLHttpRequest|connectNative|createTransport|api\/transport|https?:\/\//;

  function indexTree() {
    const files = scanSource().filter((file) => file.path.startsWith(INDEX_DIR));
    expect(files.length).toBeGreaterThan(0);
    return files;
  }

  it("has no network expression, no transport import and no message channel", () => {
    expect(findViolations(indexTree(), NETWORK)).toEqual([]);
    expect(findViolations(indexTree(), /chrome\.runtime\.sendMessage|runtime\.connect/)).toEqual([]);
  });

  it("still finds those expressions in the transport, so the pattern is not misspelled", () => {
    const transport = scanSource().filter((file) => file.path.startsWith("src/api/transport/"));
    expect(transport.length).toBeGreaterThan(0);
    expect(findViolations(transport, NETWORK).length).toBeGreaterThan(0);

    // And exactly one file in the whole tree may open a socket: a second one would mean the index
    // could acquire a network path without this scan changing at all.
    const fetchers = [...new Set(findViolations(scanSource(), /\bfetch\s*\(/).map((v) => v.path))];
    expect(fetchers).toEqual(["src/api/transport/http.ts"]);
  });

  it("would notice a call if it appeared, so the absence is meaningful", () => {
    const synthetic = [
      { path: "src/index/synthetic.ts", content: "const res = await fetch(url);" },
      { path: "src/index/synthetic.ts", content: "import { createTransport } from \"../api/transport/index.js\";" },
    ];
    expect(findViolations(synthetic, NETWORK)).toHaveLength(2);
  });
});

/**
 * The injection tree is a page-writer with no reach of its own — G4.5 (tasks 3.1, 3.4).
 *
 * `src/inject/` is the one tree in this extension that changes the DOM on purpose, so the blanket
 * rule in `tests/options/inject.spec.ts` (the perception layer never writes) cannot cover it and the
 * claims have to be narrower instead of weaker. Four of them, each with a positive control:
 *
 * 1. no network expression, no transport import, no storage read. The page is handed the text in
 *    the message it is answering, so it needs no route out and no settings of its own — and it must
 *    not acquire one, because a content script that reads `chrome.storage` is a content script that
 *    can be made to act on a setting the gate never saw.
 * 2. no click, no submit, no synthesised key event. Placing context fills a composer; it never sends
 *    the message. `src/popup.ts` does click, which is what makes that pattern non-vacuous.
 * 3. every composer selector literal lives under `src/inject/composers/`. A selector anywhere else in
 *    the tree would be provider knowledge that no `verifiedAt` date and no drift record names.
 * 4. exactly one file writes to the page. `place.ts` owns the write; resolution only reads. A write
 *    appearing in `resolve.ts` or a composer would be a second, unmeasured mutation point.
 */
describe("the injection tree cannot reach out or submit — G4.5", () => {
  const INJECT_DIR = "src/inject/";
  const COMPOSER_DIR = "src/inject/composers/";

  const NETWORK = /\bfetch\s*\(|XMLHttpRequest|connectNative|createTransport|api\/transport|https?:\/\//;
  const ACTIVATES = /\.click\s*\(|\.submit\s*\(|\.requestSubmit\s*\(|dispatchEvent|KeyboardEvent/;
  const SELECTOR_LITERAL = /#prompt-textarea|rich-textarea|\.ql-editor|#chat-input|data-testid="chat-input"/;
  const DOM_WRITE =
    /\.(innerHTML|outerHTML|textContent|innerText|value|style)\s*=|\.(appendChild|append|prepend|insertBefore|insertAdjacentHTML|insertAdjacentElement|replaceChild|removeChild|remove|setAttribute|removeAttribute|toggleAttribute|classList\.(add|remove|toggle)|click|focus)\s*\(|document\.(write|writeln|createElement|adoptNode)/;

  function injectTree() {
    const files = scanSource().filter((file) => file.path.startsWith(INJECT_DIR));
    expect(files.length).toBeGreaterThan(1);
    return files;
  }

  function composers() {
    const files = scanSource().filter((file) => file.path.startsWith(COMPOSER_DIR));
    expect(files.length).toBeGreaterThan(1);
    return files;
  }

  function outsideComposers() {
    return scanSource().filter((file) => !file.path.startsWith(COMPOSER_DIR));
  }

  it("has no network expression, no transport import and no storage read", () => {
    expect(findViolations(injectTree(), NETWORK)).toEqual([]);
    expect(findViolations(injectTree(), /chrome\.storage/)).toEqual([]);
    expect(findViolations(injectTree(), /chrome\.runtime\.sendMessage|chrome\.runtime\.connect/)).toEqual([]);
    expect(findViolations(injectTree(), /(?<![.\w])import\s*\(|(?<![.\w])require\s*\(/)).toEqual([]);
  });

  it("never clicks, submits or synthesises a key event", () => {
    expect(findViolations(injectTree(), ACTIVATES)).toEqual([]);
  });

  it("keeps every composer selector literal inside the composer tree", () => {
    expect(findViolations(outsideComposers(), SELECTOR_LITERAL)).toEqual([]);
    // Positive control: the literals are real, so the absence above is not a misspelled pattern.
    expect(findViolations(composers(), SELECTOR_LITERAL).length).toBeGreaterThan(0);
    // And they are not merely absent from the tree: one file per provider carries them.
    expect(pathsWith(composers(), SELECTOR_LITERAL).length).toBeGreaterThan(1);
  });

  it("writes to the page in exactly one file", () => {
    expect(pathsWith(injectTree(), DOM_WRITE)).toEqual(["src/inject/place.ts"]);
  });

  it("still finds each pattern where it is legitimate, so none of them is misspelled", () => {
    // A network expression lives in the transport, a click lives on the popup's export link, and DOM
    // writes live in the perception layer's surfaces. Each absence above is bounded by the same
    // pattern matching somewhere in `src/`.
    expect(findViolations(scanSource(), NETWORK).length).toBeGreaterThan(0);
    expect(findViolations(scanSource(), ACTIVATES).length).toBeGreaterThan(0);
    expect(findViolations(scanSource(), /chrome\.storage/).length).toBeGreaterThan(0);
    expect(findViolations(scanSource(), DOM_WRITE).length).toBeGreaterThan(0);
  });

  it("would notice each of them arriving in the injection tree, so every absence is meaningful", () => {
    const synthetic = [
      { path: "src/inject/synthetic.ts", content: "const res = await fetch(`${base}/memory/add`);" },
      { path: "src/inject/synthetic.ts", content: "const settings = await chrome.storage.sync.get(null);" },
      { path: "src/inject/synthetic.ts", content: "sendButton.click();" },
      { path: "src/inject/synthetic.ts", content: "form.submit();" },
      { path: "src/inject/synthetic.ts", content: "node.dispatchEvent(new KeyboardEvent(\"keydown\"));" },
      { path: "src/inject/synthetic.ts", content: "input.value = text;" },
    ];
    expect(findViolations(synthetic, NETWORK)).toHaveLength(1);
    expect(findViolations(synthetic, /chrome\.storage/)).toHaveLength(1);
    expect(findViolations(synthetic, ACTIVATES)).toHaveLength(3);
    expect(findViolations(synthetic, DOM_WRITE)).toHaveLength(2);
  });
});
