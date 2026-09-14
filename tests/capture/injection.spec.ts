/**
 * Injection specs — the write path (G4.5).
 *
 * The first claim in this file is the one that matters: **with `injectIntoAiChats` off, a provider
 * page is byte-identical after a placement is attempted.** It is asserted by serialising the live
 * document before and after and comparing strings, not by asserting that some particular branch ran,
 * because "no provider page is mutated while it is off" is a statement about the page and only the
 * page can testify to it.
 *
 * The rest of the file exists so that the off-state proof cannot pass by being the only thing that
 * works. A path that refuses everything would satisfy the first claim perfectly, so the positive
 * cases below place text into every provider's composer, walk the ladder and report the rung, prove
 * the write is one operation on the right property, and prove a failed write puts the user's draft
 * back exactly as it was found.
 *
 * Files here are synthetic, like every fixture in this repository: they show the ladder resolving on
 * the shape each rung targets. They are not evidence that a rung matches today's live DOM — the
 * adapters' `verifiedAt` dates and the manual gate carry that, and `docs/END-STATE.md` G8.13 says so.
 */

import { describe, expect, it, vi } from "vitest";

import { listFixtures, parseFixture, readFixture } from "../helpers/fixtures.js";
import { installChromeMock } from "../helpers/chrome-mock.js";
import { allComposers, composerById, composerByUrl } from "../../src/inject/registry.js";
import { resolveComposer } from "../../src/inject/resolve.js";
import { INJECTION_MAX_CHARS, placeContext, truncateAtBoundary } from "../../src/inject/place.js";
import { registerContextPlacement } from "../../src/inject/host.js";
import { PLACE_CONTEXT_REQUEST } from "../../src/inject/protocol.js";
import { chatgptComposer } from "../../src/inject/composers/chatgpt.js";
import { grokComposer } from "../../src/inject/composers/grok.js";

const CHATGPT_TEXT = readFixture("chatgpt", "conversation.html");

/**
 * A landing URL per provider, so a spec can drive the real `composerByUrl` path rather than naming an
 * adapter directly. A fixture is a page *of* a provider, and the host is what makes it that.
 */
const PROVIDER_URLS: Readonly<Record<string, string>> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
  grok: "https://grok.com/",
  deepseek: "https://chat.deepseek.com/",
};

function loadFixture(provider: string, name: string): Document {
  return parseFixture(readFixture(provider, name));
}

/** The page as the user sees it, for the byte comparisons. */
function serialise(doc: Document): string {
  return doc.documentElement.outerHTML;
}

/**
 * Run `placeContext` on the live document and report both the result and whether the page changed.
 *
 * Two failure modes are separated on purpose: a refusal that touches the page is a bug even though
 * nothing was placed, and a placement that changes the page in an unexpected way needs to say so.
 */
function attemptOnLiveDocument(
  url: string,
  options: { readonly enabled: boolean; readonly text?: string }
): { readonly report: ReturnType<typeof placeContext>; readonly changed: boolean; readonly before: string } {
  const before = serialise(document);
  const report = placeContext({
    document,
    url,
    enabled: options.enabled,
    text: options.text ?? CHATGPT_TEXT,
    sourceProvider: "chatgpt",
  });
  return { report, changed: serialise(document) !== before, before };
}

describe("no provider page is mutated while injection is off — G4.5", () => {
  it("leaves the live page byte-identical and says why", () => {
    document.body.innerHTML = parseFixture(readFixture("chatgpt", "composer.html")).body.innerHTML;

    const { report, changed } = attemptOnLiveDocument("https://chatgpt.com/", { enabled: false });

    expect(report.placed).toBe(false);
    expect(report.code).toBe("INJECTION_DISABLED");
    expect(changed).toBe(false);
    // The composer is present and resolvable in this fixture, so the refusal came from the setting
    // and not from a composer this spec happened to leave out.
    expect(resolveComposer(chatgptComposer, document).ok).toBe(true);
  });

  it("does not write the draft, the URL or the title back into the page it refused", () => {
    document.body.innerHTML = parseFixture(readFixture("grok", "composer.html")).body.innerHTML;
    const field = document.querySelector("textarea") as HTMLTextAreaElement;
    field.value = "the user was already typing this";

    const { changed, before } = attemptOnLiveDocument("https://grok.com/", { enabled: false });

    expect(changed).toBe(false);
    expect(serialise(document)).toBe(before);
    expect(field.value).toBe("the user was already typing this");
  });
});

describe("context from one provider can be placed in another's composer — G4.5", () => {
  it("places a ChatGPT capture in the Claude composer and reports the rungs it walked", () => {
    const doc = loadFixture("claude", "composer.html");

    const report = placeContext({
      document: doc,
      url: "https://claude.ai/new",
      enabled: true,
      text: CHATGPT_TEXT,
      sourceProvider: "chatgpt",
    });

    expect(report.placed).toBe(true);
    expect(report.providerId).toBe("claude");
    expect(report.sourceProvider).toBe("chatgpt");
    expect(report.wroteInto).toBe("text");
    expect(report.rungs).toEqual({ composerRoot: 0, composerInput: 0 });

    const field = doc.querySelector('fieldset div[contenteditable="true"]') as HTMLElement;
    expect(field.textContent).toBe(CHATGPT_TEXT);
  });

  it("writes `value` for a form control, which is a different operation from writing text", () => {
    const doc = loadFixture("grok", "composer.html");

    const report = placeContext({
      document: doc,
      url: "https://grok.com/",
      enabled: true,
      text: "context for grok",
    });

    expect(report.placed).toBe(true);
    expect(report.wroteInto).toBe("value");
    expect((doc.querySelector("textarea") as HTMLTextAreaElement).value).toBe("context for grok");
    // textContent is untouched, which is the assertion that the write went to the property the
    // element actually reads from rather than to whichever one was convenient.
    expect((doc.querySelector("textarea") as HTMLTextAreaElement).textContent).toBe("");
  });

  it("records the rung a drifted page forced, rather than reporting a single number", () => {
    // The canonical conversation fixture has the composer form outside `<main>` and a plain
    // textarea, so the ladder is walked two rungs deep. A report that always said `0` would look
    // identical on a page that had silently drifted.
    const doc = loadFixture("chatgpt", "conversation.html");

    const report = placeContext({
      document: doc,
      url: "https://chatgpt.com/c/abc",
      enabled: true,
      text: "short context",
    });

    expect(report.placed).toBe(true);
    expect(report.rungs).toEqual({ composerRoot: 1, composerInput: 2 });
  });

  it("resolves every shipped provider's composer from its own fixture", () => {
    for (const adapter of allComposers()) {
      const fixtures = listFixtures(adapter.id);
      expect(fixtures).toContain("composer.html");

      const url = PROVIDER_URLS[adapter.id] ?? "";
      expect(composerByUrl(url)?.id, `${adapter.id} does not claim its own landing URL`).toBe(adapter.id);

      const doc = loadFixture(adapter.id, "composer.html");
      const report = placeContext({ document: doc, url, enabled: true, text: "one line of context" });

      expect(report.placed, `${adapter.id} could not place into its own composer fixture`).toBe(true);
      expect(report.rungs).toEqual({ composerRoot: 0, composerInput: 0 });
    }
  });

  it("truncates over the budget at a word boundary and says so", () => {
    const doc = loadFixture("deepseek", "composer.html");
    const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    expect(long.length).toBeGreaterThan(INJECTION_MAX_CHARS);

    const report = placeContext({
      document: doc,
      url: "https://chat.deepseek.com/",
      enabled: true,
      text: long,
    });

    const placed = (doc.querySelector("#chat-input") as HTMLTextAreaElement).value;
    expect(report.placed).toBe(true);
    expect(report.truncated).toBe(true);
    expect(report.sourceChars).toBe(long.length);
    expect(report.placedChars).toBe(placed.length);
    expect(report.placedChars).toBeLessThanOrEqual(INJECTION_MAX_CHARS);
    expect(report.maxChars).toBe(INJECTION_MAX_CHARS);
    // A cut mid-token would leave the page holding a fragment of a word; the placed text must be a
    // prefix of the original that ends on whitespace.
    expect(long.startsWith(placed)).toBe(true);
    expect(placed.endsWith(" ")).toBe(false);
    expect(long.charAt(placed.length)).toBe(" ");
  });

  it("reports no truncation for text inside the budget", () => {
    const doc = loadFixture("deepseek", "composer.html");

    const report = placeContext({
      document: doc,
      url: "https://chat.deepseek.com/",
      enabled: true,
      text: "exactly what the user selected",
    });

    expect(report.truncated).toBe(false);
    expect(report.placedChars).toBe("exactly what the user selected".length);
    expect(report.sourceChars).toBe(report.placedChars);
  });

  it("hard-cuts text with no boundary to cut on, and still reports it", () => {
    const { text, truncated } = truncateAtBoundary("x".repeat(50), 10);

    expect(truncated).toBe(true);
    expect(text).toBe("x".repeat(10));
  });

  it("cuts at a whitespace boundary when one is late in the budget", () => {
    const text = `${"x".repeat(90)} ${"y".repeat(400)}`;

    const { text: cut, truncated } = truncateAtBoundary(text, 100);

    expect(truncated).toBe(true);
    expect(cut).toBe("x".repeat(90));
  });

  it("never gives up more than half the budget to reach a boundary", () => {
    // A single space near the start of a long token run: cutting at it would place 1 character of
    // 2000 and report success. The hard cut is the better answer, and it is still reported.
    const text = `a ${"b".repeat(400)}`;

    const { text: cut, truncated } = truncateAtBoundary(text, 100);

    expect(truncated).toBe(true);
    expect(cut).toBe(text.slice(0, 100));
    expect(cut.length).toBe(100);
  });

  it("refuses an empty capture rather than clearing the user's draft", () => {
    const doc = loadFixture("grok", "composer.html");
    const field = doc.querySelector("textarea") as HTMLTextAreaElement;
    field.value = "a draft worth keeping";

    const report = placeContext({
      document: doc,
      url: "https://grok.com/",
      enabled: true,
      text: "   \n  ",
    });

    expect(report.placed).toBe(false);
    expect(report.code).toBe("CONTEXT_EMPTY");
    expect(field.value).toBe("a draft worth keeping");
  });
});

describe("nothing is submitted and no request carries the context — G4.5", () => {
  it("issues no request of any kind while placing", () => {
    const doc = loadFixture("claude", "composer.html");
    const requests: string[] = [];

    const fetchSpy = vi.fn((..._args: unknown[]) => {
      requests.push("fetch");
      return Promise.reject(new Error("the injection path must not reach the network"));
    });
    const xhrSpy = vi.fn(() => {
      requests.push("XMLHttpRequest");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhrSpy);
    const mock = installChromeMock();
    const connectNative = mock.runtime.connectNative;

    try {
      const report = placeContext({
        document: doc,
        url: "https://claude.ai/",
        enabled: true,
        text: CHATGPT_TEXT,
      });

      expect(report.placed).toBe(true);
      expect(requests).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrSpy).not.toHaveBeenCalled();
      // A message to the worker would be the other way this path could ship the conversation
      // somewhere; the page holds no `chrome.runtime.sendMessage` call in the first place, and the
      // source scan asserts that, while this asserts the native port was not opened either.
      expect(connectNative).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("dispatches no submit, click or key event", () => {
    document.body.innerHTML = parseFixture(readFixture("chatgpt", "composer.html")).body.innerHTML;
    const form = document.querySelector("form") as HTMLFormElement;
    const button = document.querySelector("button") as HTMLButtonElement;
    const events: string[] = [];
    for (const type of ["submit", "click", "keydown", "keypress", "keyup", "input", "change"]) {
      form.addEventListener(type, () => events.push(`form:${type}`));
      button.addEventListener(type, () => events.push(`button:${type}`));
    }

    const report = placeContext({
      document,
      url: "https://chatgpt.com/",
      enabled: true,
      text: "placed but not sent",
    });

    expect(report.placed).toBe(true);
    expect(events).toEqual([]);
    // Positive control: the page did change, so "no events" is not the observation of a no-op.
    expect((document.querySelector("#prompt-textarea") as HTMLElement).textContent).toBe(
      "placed but not sent"
    );
    expect(form.getAttribute("action")).toBeNull();
  });
});

describe("a failed placement leaves the draft exactly as it was — G4.5", () => {
  it("keeps the draft and inserts nothing elsewhere when the composer is read-only", () => {
    const doc = parseFixture(`<!doctype html><html><body><main>
      <textarea id="chat-input" readonly>the user's own draft</textarea>
      <textarea id="somewhere-else">not a composer</textarea>
    </main></body></html>`);
    const before = serialise(doc);

    const report = placeContext({
      document: doc,
      url: "https://chat.deepseek.com/",
      enabled: true,
      text: "this must not land anywhere",
    });

    expect(report.placed).toBe(false);
    expect(report.code).toBe("COMPOSER_NOT_WRITABLE");
    expect(report.providerId).toBe("deepseek");
    expect(serialise(doc)).toBe(before);
  });

  it("restores the draft when the page discards the write", () => {
    const doc = loadFixture("deepseek", "composer.html");
    const field = doc.querySelector("#chat-input") as HTMLTextAreaElement;
    field.value = "the user's own draft";

    // A framework-controlled composer that re-renders on its next tick is modelled by a `value`
    // setter on the instance that accepts and ignores the assignment. The write then "succeeds" from
    // the caller's point of view, which is exactly the case that a read-back catches and a try/catch
    // does not.
    Object.defineProperty(field, "value", {
      configurable: true,
      get: () => "the user's own draft",
      set: () => undefined,
    });

    const report = placeContext({
      document: doc,
      url: "https://chat.deepseek.com/",
      enabled: true,
      text: "context the page will not keep",
    });

    expect(report.placed).toBe(false);
    expect(report.code).toBe("COMPOSER_NOT_WRITABLE");
    expect(report.detail).toContain("restored");
    expect(field.value).toBe("the user's own draft");
  });

  it("refuses a page that is not a supported AI chat without touching it", () => {
    document.body.innerHTML = "<main><form><textarea></textarea></form></main>";

    const { report, changed } = attemptOnLiveDocument("https://example.com/", { enabled: true });

    expect(report.placed).toBe(false);
    expect(report.code).toBe("UNSUPPORTED_PROVIDER");
    expect(changed).toBe(false);
  });
});

describe("composer resolution walks the ladder and fails closed — G8.2, G8.7", () => {
  it("checks the landmark before it tries a single rung", () => {
    const doc = parseFixture("<!doctype html><html><body><div>a page with none of the landmarks</div></body></html>");
    const rungSpy = vi.spyOn(doc, "querySelectorAll");

    const result = resolveComposer(chatgptComposer, doc);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("DOM_SHAPE_UNRECOGNIZED");
    expect(result.slot).toBe("composerRoot");
    expect(result.rung).toBe(-1);
    expect(rungSpy).not.toHaveBeenCalled();
  });

  it("refuses a landmark-only page instead of writing somewhere plausible", () => {
    // A landing page: the app shell exists, the composer does not. The refusal has to be typed, since
    // a resolver that returned the first `<textarea>` it could find would place text in a search box.
    const doc = parseFixture("<!doctype html><html><body><main><form><input type='search'></form></main></body></html>");

    const report = placeContext({
      document: doc,
      url: "https://chatgpt.com/",
      enabled: true,
      text: "context with nowhere to go",
    });

    expect(report.placed).toBe(false);
    expect(report.code).toBe("DOM_SHAPE_UNRECOGNIZED");
    expect((doc.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("refuses an ambiguous rung rather than choosing one", () => {
    const doc = parseFixture("<!doctype html><html><body><main><form><textarea>one</textarea><textarea>two</textarea></form></main></body></html>");

    const result = resolveComposer(grokComposer, doc);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("COMPOSER_AMBIGUOUS");
    expect(result.slot).toBe("composerInput");
    expect(result.rung).toBe(0);
  });

  it("refuses a field that is not inside the resolved root", () => {
    // The id matches, the form matches, and the node is not in it. This is the case a single
    // `querySelector` cannot distinguish from success.
    const doc = parseFixture(`<!doctype html><html><body><main>
      <form></form>
      <div id="prompt-textarea" contenteditable="true"></div>
    </main></body></html>`);

    const result = resolveComposer(chatgptComposer, doc);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("DOM_SHAPE_UNRECOGNIZED");
    expect(result.detail).toContain("not inside");
  });

  it("claims a host and nothing narrower, because a new chat page has no conversation on it", () => {
    expect(composerByUrl("https://chatgpt.com/")?.id).toBe("chatgpt");
    expect(composerByUrl("https://chat.openai.com/")?.id).toBe("chatgpt");
    expect(composerByUrl("https://chatgpt.com/c/abc")?.id).toBe("chatgpt");
    expect(composerByUrl("https://claude.ai/")?.id).toBe("claude");
    expect(composerByUrl("https://example.com/")).toBeUndefined();
    // A host that merely contains a provider's name is not that provider.
    expect(composerByUrl("https://notchatgpt.com/")).toBeUndefined();
    expect(composerById("gemini")).toBeDefined();
    expect(composerById("nope")).toBeUndefined();
  });

  it("keeps one composer adapter per provider id, matching the capture registry's ids", () => {
    const ids = allComposers().map((adapter) => adapter.id);

    expect(ids).toEqual(["chatgpt", "claude", "gemini", "grok", "deepseek"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const adapter of allComposers()) {
      expect(adapter.landmarks.length).toBeGreaterThan(0);
      expect(adapter.ladders.composerRoot.length).toBeGreaterThan(0);
      expect(adapter.ladders.composerInput.length).toBeGreaterThan(0);
      expect(adapter.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("the page answers a placement request — G4.5", () => {
  it("places the text from the message and replies with the report", () => {
    const mock = installChromeMock();
    let listener: ((message: unknown, sender: unknown, respond: (r: unknown) => void) => boolean) | undefined;
    mock.runtime.onMessage.addListener.mockImplementation((callback: never) => {
      listener = callback as typeof listener;
    });

    const doc = loadFixture("claude", "composer.html");
    registerContextPlacement({ url: () => "https://claude.ai/", doc: () => doc });

    expect(listener).toBeTypeOf("function");
    const replies: unknown[] = [];
    const returned = listener?.(
      { type: PLACE_CONTEXT_REQUEST, text: "context from another provider", sourceProvider: "chatgpt" },
      {},
      (reply) => replies.push(reply)
    );

    expect(returned).toBe(true);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      ok: true,
      report: { placed: true, providerId: "claude", sourceProvider: "chatgpt" },
    });
  });

  it("ignores a message that is not a placement request", () => {
    const mock = installChromeMock();
    let listener: ((message: unknown, sender: unknown, respond: (r: unknown) => void) => boolean) | undefined;
    mock.runtime.onMessage.addListener.mockImplementation((callback: never) => {
      listener = callback as typeof listener;
    });
    registerContextPlacement({
      url: () => "https://claude.ai/",
      doc: () => loadFixture("claude", "composer.html"),
    });

    const replies: unknown[] = [];
    const returned = listener?.({ type: "CAPTURE_UPDATE" }, {}, (reply) => replies.push(reply));

    expect(returned).toBe(false);
    expect(replies).toEqual([]);
  });
});
