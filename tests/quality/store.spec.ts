/**
 * Store-submission specs.
 *
 * `docs/STORE.md` tells a person exactly what to paste into the Chrome Web Store dashboard. Every
 * sentence in it that names a manifest fact is therefore an assertion about `public/manifest.json`,
 * and it is checked here rather than trusted — a listing whose short description has drifted from
 * the package's cannot be corrected in the dashboard at all, because package metadata is read-only
 * after upload and fixing it means a version bump.
 *
 * The permission table is the load-bearing part. A permission added to the manifest without a
 * justification is a submission that declares less than it requests, which is the failure this spec
 * exists to make impossible: the check is set equality in both directions, so a row describing a
 * permission that is no longer declared fails too.
 *
 * The artwork assertions read each PNG's IHDR rather than checking that the file exists, for the
 * reason `09b82fc` recorded: four icon files once existed and were 1x1, and existence assertions
 * passed the whole time.
 *
 * The Privacy tab checks are a second kind of assertion. Four of that form's boxes are free text
 * with a 1,000-character limit, the host justification and the remote-code justification are two
 * more, and the data-usage section is nine checkboxes whose answers are displayed publicly. Text
 * kept in this document for copying is therefore held to the limit the form enforces and to the
 * labels the form shows — a justification the form will not accept is one nobody can paste, and an
 * answer the document contradicts is worse than no answer at all.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PUBLIC_DIR, REPO_ROOT } from "../helpers/scan.js";

const STORE_DOC = readFileSync(path.join(REPO_ROOT, "docs", "STORE.md"), "utf8").replace(
  /\r\n/g,
  "\n"
);
const PRIVACY_DOC = path.join(REPO_ROOT, "docs", "PRIVACY.md");
const COPY_ASSETS = readFileSync(path.join(REPO_ROOT, "scripts", "copy-assets.js"), "utf8");

interface Manifest {
  name?: string;
  version?: string;
  description?: string;
  permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
}

const manifest: Manifest = JSON.parse(
  readFileSync(path.join(PUBLIC_DIR, "manifest.json"), "utf8")
) as Manifest;

/** The body of the level-two section whose heading starts with `heading`. */
function section(heading: string): string {
  const lines = STORE_DOC.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) throw new Error(`docs/STORE.md has no section starting "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/**
 * The body of the fenced block under a `#### <label>` heading.
 *
 * Every free-text box on the dashboard's Privacy tab gets one fence, headed by the dashboard's own
 * label, so the box is filled by copying a block instead of retyping it. A blank line between the
 * heading and the fence is allowed; anything else means the block cannot be found by the label the
 * form shows, which is the same as not having it.
 */
function pasteBlock(label: string): string {
  const lines = STORE_DOC.split("\n");
  const start = lines.findIndex((line) => line.trim() === `#### ${label}`);
  if (start === -1) throw new Error(`docs/STORE.md has no field "${label}"`);

  let open = start + 1;
  while (open < lines.length && lines[open].trim() === "") open += 1;
  if (lines[open]?.trim() !== "```") throw new Error(`field "${label}" has no fenced block`);

  let close = open + 1;
  while (close < lines.length && lines[close].trim() !== "```") close += 1;
  if (close === lines.length) throw new Error(`field "${label}" has an unterminated fenced block`);

  return lines.slice(open + 1, close).join("\n");
}

/** Dimensions declared in a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex"), `${file} is not a PNG`).toBe("89504e470d0a1a0a");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The colour type byte of a PNG's IHDR: 2 is truecolour with no alpha, 6 is truecolour with alpha. */
function pngColourType(file: string): number {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString("hex"), `${file} is not a PNG`).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString("latin1"), `${file} IHDR`).toBe("IHDR");
  return bytes[25];
}

describe("store submission package", () => {
  it("exists and is long enough to be a runbook", () => {
    expect(STORE_DOC.length).toBeGreaterThan(4000);
  });

  it("does not claim the item is listed", () => {
    // The upload is a manual step. If this document ever asserts a listing exists, it has to cite
    // the listing, and there is no mechanism here for it to have gained one.
    expect(STORE_DOC).toMatch(/not yet uploaded/i);
  });

  it("quotes the manifest's short description byte-for-byte", () => {
    expect(manifest.description).toBeTruthy();
    expect(STORE_DOC).toContain(`\`\`\`\n${manifest.description}\n\`\`\``);
  });

  it("keeps the short description inside the 132-character limit the dashboard enforces", () => {
    // The field is package metadata, and the dashboard refuses to edit it after upload, so a
    // description over the limit is an item that cannot be submitted and cannot be repaired
    // without a version bump. The count the document states is checked too: a stated count that
    // has drifted from the manifest is the same defect as the description having drifted.
    expect(manifest.description).toBeTruthy();
    const description = manifest.description ?? "";
    expect(description.length).toBeLessThanOrEqual(132);
    expect(STORE_DOC).toContain(`${description.length} characters against a limit of 132`);
  });

  it("names the manifest version in the archive filename", () => {
    expect(manifest.version).toBeTruthy();
    expect(STORE_DOC).toContain(`hipcortex-chrome-extension-v${manifest.version}.zip`);
  });

  it("justifies every declared permission, and only declared permissions", () => {
    const table = section("## 6. Permission justifications");
    const justified = new Set(
      [...table.matchAll(/^\|\s*`([a-zA-Z]+)`\s*\|/gm)].map((match) => match[1])
    );
    const declared = new Set(manifest.permissions ?? []);
    expect([...justified].sort()).toEqual([...declared].sort());
  });

  it("points every cited source path at a file that exists", () => {
    const table = section("## 6. Permission justifications");
    const cited = [...table.matchAll(/`((?:src|scripts)\/[^`]+)`/g)].map((match) => match[1]);
    expect(cited.length).toBeGreaterThan(5);
    const missing = cited.filter((rel) => !existsSync(path.join(REPO_ROOT, rel)));
    expect(missing).toEqual([]);
  });

  it("declares the dimensions the store demands of each graphic asset", () => {
    expect(STORE_DOC).toContain("128×128");
    expect(STORE_DOC).toContain("440×280");
    expect(STORE_DOC).toContain("1280×800");
  });

  it("names the required privacy policy and the file it lives in", () => {
    expect(existsSync(PRIVACY_DOC)).toBe(true);
    expect(readFileSync(PRIVACY_DOC, "utf8").length).toBeGreaterThan(1500);
    expect(STORE_DOC).toContain("docs/PRIVACY.md");
  });
});

describe("store listing artwork", () => {
  const artwork = [
    { file: "store/promo-tile-440x280.png", width: 440, height: 280 },
    { file: "store/marquee-1400x560.png", width: 1400, height: 560 },
  ];

  for (const asset of artwork) {
    it(`${asset.file} is a real ${asset.width}x${asset.height} PNG`, () => {
      const absolute = path.join(REPO_ROOT, asset.file);
      expect(existsSync(absolute), `${asset.file} is missing`).toBe(true);
      expect(pngSize(absolute)).toEqual({ width: asset.width, height: asset.height });
    });
  }

  it("reuses the packaged 128x128 icon rather than duplicating it", () => {
    expect(pngSize(path.join(PUBLIC_DIR, "icons", "icon128.png"))).toEqual({
      width: 128,
      height: 128,
    });
    expect(STORE_DOC).toContain("public/icons/icon128.png");
  });

  it("keeps listing artwork out of the extension package", () => {
    // `scripts/copy-assets.js` decides what reaches `dist/`. Listing artwork is not shipped. The
    // assertion is on the copy mechanism, not on the word "store" — that file's own comment
    // mentions the store, and matching prose would make this test assert nothing.
    expect(COPY_ASSETS).not.toMatch(/store[\\/]/);
  });

  it("keeps the packaged icons in the RGBA form the manifest needs", () => {
    // The dashboard wants screenshots as 24-bit PNG *without* alpha, and the icons the other way
    // round: `tests/quality/manifest.spec.ts` decodes `icons/icon128.png` as four bytes per pixel
    // and reads the alpha channel of two of them. Producing a screenshot is therefore the act most
    // likely to leave the icons in the wrong colour type, so the pairing is pinned here.
    for (const size of [16, 32, 48, 128]) {
      expect(pngColourType(path.join(PUBLIC_DIR, "icons", `icon${size}.png`)), `icon${size}`).toBe(
        6
      );
    }
  });
});

describe("store listing screenshots", () => {
  const SCREENSHOT_DIR = path.join(REPO_ROOT, "store", "screenshots");
  const shipped = existsSync(SCREENSHOT_DIR)
    ? readdirSync(SCREENSHOT_DIR)
        .filter((name) => name.endsWith(".png"))
        .sort()
    : [];

  it("ships at least one screenshot and no more than the five the dashboard accepts", () => {
    expect(shipped.length).toBeGreaterThanOrEqual(1);
    expect(shipped.length).toBeLessThanOrEqual(5);
  });

  it("ships every screenshot at 1280x800 with no alpha channel", () => {
    // Both halves matter and neither implies the other. A screenshot at the wrong size is refused
    // by the dashboard; one carrying alpha is refused for a different reason, and the extension's
    // own artwork is exactly the file it would be copied from.
    for (const name of shipped) {
      const absolute = path.join(SCREENSHOT_DIR, name);
      expect(pngSize(absolute), `${name} dimensions`).toEqual({ width: 1280, height: 800 });
      expect(pngColourType(absolute), `${name} colour type`).toBe(2);
    }
  });

  it("names every shipped screenshot in the runbook", () => {
    // §9 is what a person follows when the dashboard says an asset is missing. A file the runbook
    // does not name is a file nobody knows to upload, which is how this task started.
    expect(STORE_DOC).toContain("store/screenshots/");
    for (const name of shipped) {
      expect(STORE_DOC, `${name} is not named in docs/STORE.md`).toContain(name);
    }
  });
});

describe("store privacy tab copy", () => {
  /** Every category the data-usage section lists, in the order the form lists them. */
  const DATA_CATEGORIES = [
    "Personally identifiable information",
    "Health information",
    "Financial and payment information",
    "Authentication information",
    "Personal communications",
    "Location",
    "Web history",
    "User activity",
    "Website content",
  ];

  /** Category to the `yes`/`no` answer the §5 table gives it. */
  function dataAnswers(): Map<string, string> {
    const table = section("## 5. Privacy — data disclosure");
    const rows = table.matchAll(/^\|\s*([^|]+?)\s*\|\s*\*{0,2}(yes|no)\*{0,2}\s*\|/gim);
    return new Map([...rows].map((row) => [row[1], row[2].toLowerCase()]));
  }

  it("keeps every paste-ready block inside the form's 1,000-character limit", () => {
    // The limit is the whole reason these live in fences. Prose in a paragraph can be any length;
    // a block labelled as the box's contents cannot, so the length is asserted rather than noticed
    // when the form refuses the paste.
    const labels = [...STORE_DOC.matchAll(/^####\s+(.+?)\s*$/gm)].map((match) => match[1]);
    expect(labels.length).toBeGreaterThanOrEqual(10);
    for (const label of labels) {
      expect(pasteBlock(label).length, label).toBeLessThanOrEqual(1000);
    }
  });

  it("answers the single-purpose box with a statement that names the destination", () => {
    const text = pasteBlock("Single purpose description");
    expect(text.length).toBeGreaterThan(300);
    // The box is reviewed against the permission list, and the permissions exist to reach a runtime
    // on the user's own machine. A statement that omits where a capture goes reviews badly.
    expect(text).toMatch(/native messaging|loopback/i);
    expect(text).toMatch(/the user's own/i);
  });

  it("gives every declared permission its own justification block", () => {
    // Paired with the set-equality test above: that one proves every permission has a row, this one
    // proves the row has something the form will accept in the box next to it.
    for (const permission of manifest.permissions ?? []) {
      const text = pasteBlock(`${permission} justification`);
      expect(text.length, `${permission} justification is too short to justify anything`).toBeGreaterThan(
        150
      );
    }
  });

  it("accounts for every host the manifest declares", () => {
    // A reviewer compares this box against the package. A pattern the manifest declares and the box
    // does not mention is the one they will ask about, so the box has to cover all of them — the
    // loopback pair and the provider origins both.
    const text = pasteBlock("Host permission justification");
    const declared = [
      ...(manifest.host_permissions ?? []),
      ...(manifest.optional_host_permissions ?? []),
    ];
    expect(declared.length).toBeGreaterThanOrEqual(2);
    for (const pattern of declared) {
      expect(text, `${pattern} is declared but not explained`).toContain(pattern);
    }
    expect(text).toMatch(/No remote host is pre-authorised/);
  });

  it("answers the remote-code box with an unqualified negative", () => {
    const text = pasteBlock("Remote code justification");
    expect(text).toMatch(/^No\b/);
    expect(text).toContain("eval");
    // The one bundled script is the claim that makes "no" true, so the box has to name it.
    expect(text).toContain("dist/content.js");
  });

  it("answers all nine data-usage categories and answers none of them twice", () => {
    const answers = dataAnswers();
    expect(answers.size).toBe(DATA_CATEGORIES.length);
    for (const category of DATA_CATEGORIES) {
      expect(answers.get(category), `${category} is not answered in §5`).toMatch(/^(yes|no)$/);
    }
  });

  it("declares the categories the capture contract demonstrably reaches", () => {
    // These three are not judgment calls. `Provenance.conversationUrl` is a required field of every
    // capture, the provider adapters read conversation text out of the page, and a page's title and
    // URL are read when the user captures one. Answering "no" while the schema requires that data
    // is the under-declaration the store rejects for, so it is pinned here.
    const answers = dataAnswers();
    for (const category of ["Personal communications", "Website content", "Web history"]) {
      expect(answers.get(category), `${category} must be declared`).toBe("yes");
    }
  });

  it("declares authentication information while the settings hold a credential", () => {
    // The mechanism matters more than the answer. `apiKey` is a field of `DEFAULT_SETTINGS`, is
    // sent to the runtime as a bearer token, and rides in `chrome.storage.sync`; while that is
    // true, "no" would be a declaration the code contradicts. If the field is ever removed, this
    // test stops asserting rather than asserting a stale answer.
    const settings = readFileSync(path.join(REPO_ROOT, "src", "types", "index.ts"), "utf8");
    if (!/^\s*apiKey\s*:/m.test(settings)) return;
    expect(dataAnswers().get("Authentication information")).toBe("yes");
  });

  it("states all three certifications the form requires", () => {
    const table = section("## 5. Privacy — data disclosure");
    expect(table).toMatch(/Not sold to third parties/i);
    expect(table).toMatch(/purposes unrelated to the single purpose/i);
    expect(table).toMatch(/creditworthiness/i);
  });

  it("publishes a privacy policy URL that names the policy in this repository", () => {
    // The field is required and takes one URL. It has to be the rendered policy, in the default
    // branch, in the repository this package is developed in — a link to a branch that may not
    // exist, or to a raw API endpoint, is not a policy a reviewer can read.
    const url = pasteBlock("Privacy policy URL").trim();
    expect(url.length).toBeGreaterThan(0);
    expect(url.length).toBeLessThanOrEqual(2048);
    expect(url).toMatch(
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/blob\/main\/docs\/PRIVACY\.md$/
    );
    expect(existsSync(PRIVACY_DOC)).toBe(true);
  });
});

/**
 * The documents and the shipped settings, held to each other.
 *
 * This block exists because the two drifted once, in the direction that matters. `autoCapture` was
 * flipped to `true` and the consent flow that made the flip acceptable was built, but the paste-ready
 * listing copy, the reviewer instructions, the privacy disclosure for *Web history*, the privacy
 * policy, the single-purpose box and the end-state statement all still described a build whose
 * capture shipped switched off — and one of them, `docs/END-STATE.md`, contradicted its own locked
 * interpretation at the same time. Nothing in the suite could fail on it: every document assertion
 * here was about a manifest field, and no assertion anywhere compared a sentence about a *setting*
 * to the setting's value.
 *
 * A document that tells the user capture is off while it is on is the same defect as the button that
 * hangs, and it is worse in one respect: the store makes the listing read-only after the first
 * upload, so a wrong sentence there cannot be corrected without a version bump.
 */
describe("the documents agree with the shipped capture defaults", () => {
  const SETTINGS = readFileSync(path.join(REPO_ROOT, "src", "types", "index.ts"), "utf8");
  const END_STATE = readFileSync(path.join(REPO_ROOT, "docs", "END-STATE.md"), "utf8");
  const POLICY = readFileSync(path.join(REPO_ROOT, "docs", "PRIVACY.md"), "utf8");
  const README = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
  const LISTING = section("## 3. Paste-ready listing copy");

  /** Whether `src/types/index.ts` currently ships `autoCapture` on, read rather than assumed. */
  const SHIPS_ON = /^\s*autoCapture:\s*true\b/m.test(SETTINGS);

  it("reads the shipped default from the source rather than assuming it", () => {
    // If `autoCapture` ever loses its literal `true`, this turns red instead of silently inverting
    // every assertion below into a tautology. `DEFAULT_SETTINGS` is the only place it can be set.
    expect(SETTINGS).toMatch(/export const DEFAULT_SETTINGS/);
    expect(SETTINGS).toMatch(/^\s*autoCapture:\s*(true|false)\b/m);
    expect(SHIPS_ON).toBe(true);
  });

  it("never tells the reader that capture ships switched off", () => {
    // The exact sentences the previous revision carried, kept verbatim so the regression is
    // recognised rather than merely absent.
    const SWITCHED_OFF = /ships disabled|capture is off until|off until you switch it on/i;
    for (const [name, text] of [
      ["docs/STORE.md §3", LISTING],
      ["docs/STORE.md", STORE_DOC],
      ["docs/PRIVACY.md", POLICY],
      ["README.md", README],
      ["docs/END-STATE.md", END_STATE],
    ] as const) {
      expect(text, `${name} states a switch-off default while autoCapture ships on`).not.toMatch(
        SWITCHED_OFF
      );
    }
  });

  it("states the default in the end-state section that is authoritative for it", () => {
    // G1's statement is what the change set is read against, so it has to agree with the settings
    // object. It said the opposite while G1.10's locked interpretation said `true`.
    const statement = END_STATE.slice(END_STATE.indexOf("## G1 — "), END_STATE.indexOf("## G2 — "));
    expect(statement).toMatch(/`autoCapture` defaults to `true`/);
    expect(statement).not.toMatch(/defaults to `false`/);
  });

  it("names the site grant wherever the listing says what the extension reads", () => {
    // With the flag on by default, the site grant is the only thing standing between an install and
    // a page it reads, so every statement of what it reads has to name it. These are the three
    // places the store displays to a person — the listing, the single-purpose box and the policy.
    const GRANT = /allow|grant|permission/i;
    expect(LISTING).toMatch(GRANT);
    expect(LISTING).toMatch(/never touches a site you have not allowed/i);
    expect(pasteBlock("Single purpose description")).toMatch(GRANT);
    expect(POLICY).toMatch(GRANT);
  });

  it("describes the site grant as one request for the declared list and nothing else", () => {
    // A reviewer reads this box against the manifest's `optional_host_permissions`. The declared
    // patterns are asserted elsewhere; what is asserted here is that the document says the request
    // is for that list, because a build that asked for an origin the manifest does not declare
    // would be asking for a permission the reviewer never approved.
    const box = pasteBlock("Host permission justification");
    expect(box).toMatch(/optional_host_permissions/);
    expect(box).toMatch(/settings page/i);
    expect(box).not.toMatch(/nothing requests them at runtime/i);
  });
});

