/**
 * Types for `scripts/zip.js`, so `tests/quality/zip.spec.ts` can import the writer directly. The
 * script itself is plain ESM JavaScript and is not compiled; this declaration exists only to give
 * the spec a typed import.
 */

export interface ZipEntry {
  /** Always uses `/`, never the platform separator. */
  name: string;
  content: Buffer;
}

/** The CRC-32 the zip format stores for each entry. */
export declare function crc32(buffer: Buffer): number;

/** Every file under `dir` as an entry, name-sorted, with `/` separators in each name. */
export declare function collectFiles(dir: string, prefix?: string): ZipEntry[];

/**
 * The same entries, with `key` removed from the root `manifest.json`.
 *
 * The Chrome Web Store refuses a package whose manifest carries `key`, while an unpacked extension
 * loaded from `dist/` needs it to pin the ID the native messaging host names in `allowed_origins`.
 * The archive and `dist/` therefore differ by exactly this field.
 */
export declare function storeSafeEntries(entries: ZipEntry[]): ZipEntry[];

/** Build a ZIP archive (method 8, deflate) from `entries`. Deterministic for a fixed `when`. */
export declare function createZip(entries: ZipEntry[], when?: Date): Buffer;

/** Every entry name in an archive, read back from its central directory. */
export declare function readZipNames(archive: Buffer): string[];
