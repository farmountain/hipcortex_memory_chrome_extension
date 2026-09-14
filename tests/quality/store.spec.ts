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
