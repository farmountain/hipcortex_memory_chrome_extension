/**
 * Packaging specs (task 1.10).
 *
 * The archive a person uploads to the Chrome Web Store has to be ZIP-conformant, and the one thing
 * that was not conformant was invisible from the extension's side: `Compress-Archive` on Windows
 * PowerShell 5.1 writes entry names with `\` separators, and the extension loads from `dist/` either
 * way, so no loadability test could have noticed. The release for this repository shipped an archive
 * with 148 of 148 entries using backslashes.
 *
 * So the writer is pinned directly rather than through the extension's behaviour: `/` in every entry
 * name, `manifest.json` at the root, the stored bytes recoverable, and the whole archive stable for
 * a fixed timestamp.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import { afterAll, describe, expect, it } from "vitest";

import { collectFiles, createZip, crc32, readZipNames } from "../../scripts/zip.js";

const FIXTURE = mkdtempSync(path.join(tmpdir(), "hipcortex-zip-"));
mkdirSync(path.join(FIXTURE, "nested", "deeper"), { recursive: true });
writeFileSync(path.join(FIXTURE, "manifest.json"), '{"manifest_version":3}');
writeFileSync(path.join(FIXTURE, "nested", "inner.txt"), "hello");
writeFileSync(path.join(FIXTURE, "nested", "deeper", "leaf.txt"), "world");

afterAll(() => {
  rmSync(FIXTURE, { recursive: true, force: true });
});

/** The uncompressed bytes of the archive's first entry, read through its local file header. */
function firstEntryBytes(archive: Buffer): Buffer {
  expect(archive.readUInt32LE(0)).toBe(0x04034b50);
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  const compressedSize = archive.readUInt32LE(18);
  const start = 30 + nameLength + extraLength;
  return inflateRawSync(archive.subarray(start, start + compressedSize));
}

describe("the archive the store receives is ZIP-conformant — task 1.10", () => {
  it("collects nested files with forward-slash names on every platform", () => {
    const names = collectFiles(FIXTURE)
      .map((entry) => entry.name)
      .sort();

    expect(names).toEqual(["manifest.json", "nested/deeper/leaf.txt", "nested/inner.txt"]);
  });

  it("writes no entry name with a backslash", () => {
    // The specific defect: APPNOTE 4.4.17.1 names `/` as the separator, and the version of
    // `scripts/package.js` that used a platform packer produced 148 backslash entries.
    const names = readZipNames(createZip(collectFiles(FIXTURE)));

    expect(names.length).toBe(3);
    expect(names.filter((name) => name.includes("\\"))).toEqual([]);
  });

  it("puts manifest.json at the archive root rather than inside a folder", () => {
    const names = readZipNames(createZip(collectFiles(FIXTURE)));

    expect(names).toContain("manifest.json");
    expect(names.filter((name) => name.endsWith("manifest.json"))).toEqual(["manifest.json"]);
  });

  it("stores the bytes it was given, recoverable from the local header", () => {
    const archive = createZip([{ name: "nested/inner.txt", content: Buffer.from("hello") }]);

    expect(firstEntryBytes(archive).toString("utf8")).toBe("hello");
  });

  it("reads its own central directory back in insertion order", () => {
    const entries = collectFiles(FIXTURE);

    expect(readZipNames(createZip(entries))).toEqual(entries.map((entry) => entry.name));
  });

  it("is byte-identical for a fixed timestamp, so a rebuild is reproducible", () => {
    const when = new Date(2026, 0, 1, 12, 0, 0);
    const entries = collectFiles(FIXTURE);

    expect(createZip(entries, when).equals(createZip(entries, when))).toBe(true);
  });

  it("computes the CRC-32 the format defines", () => {
    // The standard check value for the ASCII string "123456789".
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
