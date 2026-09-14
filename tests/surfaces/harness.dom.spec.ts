import { describe, expect, it } from "vitest";

/**
 * Task 1.3 — the jsdom project's boot assertion.
 *
 * The second case is not decoration: "extraction mutates nothing" (G1.6) is asserted by serialising
 * a fixture document before and after `extract()`. That assertion is only meaningful if parsing a
 * fixture produces a *detached* document that cannot touch the live one, which is what it checks.
 */
describe("test harness (jsdom project)", () => {
  it("provides a document and a DOMParser", () => {
    expect(typeof document).toBe("object");
    expect(typeof DOMParser).toBe("function");
  });

  it("parses markup into a detached document, leaving the live one untouched", () => {
    const parsed = new DOMParser().parseFromString("<main><p>hi</p></main>", "text/html");
    expect(parsed.querySelector("p")?.textContent).toBe("hi");
    expect(document.body.innerHTML).toBe("");
  });
});
