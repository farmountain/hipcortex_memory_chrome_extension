/**
 * A minimal ZIP writer, so the archive that goes to the store does not depend on a packer's
 * platform behaviour.
 *
 * `Compress-Archive` on Windows PowerShell 5.1 writes entry names with `\` separators. The ZIP
 * specification does not allow that — APPNOTE 4.4.17.1 names `/` as the separator — and the
 * release for this extension shipped an archive with 148 of 148 entries using backslashes, which
 * no test covered because the extension loads from `dist/` regardless.
 *
 * Pure and side-effect free apart from reading the directory passed to `collectFiles`, so the
 * separator rule can be pinned by a unit test rather than by uploading to the store and finding out.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** The CRC-32 the zip format stores for each entry. */
export function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** MS-DOS date and time, which is the timestamp a zip stores. */
function dosStamp(when) {
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
    date: ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/**
 * Every file under `dir` as an entry, depth first and name-sorted so the archive is reproducible.
 * The entry name is built from the relative path with its separator normalised to `/`.
 */
export function collectFiles(dir, prefix = "") {
  const found = [];
  const children = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const child of children) {
    const name = prefix === "" ? child.name : `${prefix}/${child.name}`;
    if (child.isDirectory()) found.push(...collectFiles(path.join(dir, child.name), name));
    else found.push({ name, content: readFileSync(path.join(dir, child.name)) });
  }
  return found;
}

/** Build a ZIP archive (method 8, deflate) from `entries`. Deterministic for a fixed `when`. */
export function createZip(entries, when = new Date()) {
  const stamp = dosStamp(when);
  const local = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const body = deflateRawSync(entry.content, { level: 9 });
    const crc = crc32(entry.content);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed to extract
    header.writeUInt16LE(0x0800, 6); // general purpose flag: names are UTF-8
    header.writeUInt16LE(8, 8); // compression method: deflate
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(entry.content.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // extra field length
    local.push(header, name, body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed to extract
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(stamp.time, 12);
    record.writeUInt16LE(stamp.date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(entry.content.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(0, 30); // extra field length
    record.writeUInt16LE(0, 32); // comment length
    record.writeUInt16LE(0, 34); // disk number start
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(offset, 42); // offset of the local header
    central.push(record, name);

    offset += header.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...local, directory, end]);
}

/** Every entry name in an archive, read back from its central directory. */
export function readZipNames(archive) {
  // The central directory does not begin at the start of the file: its offset is recorded in the
  // end-of-central-directory record, which the format fixes at the last 22 bytes when there is no
  // trailing comment.
  const end = archive.length - 22;
  if (end < 0 || archive.readUInt32LE(end) !== 0x06054b50) return [];

  const names = [];
  let position = archive.readUInt32LE(end + 16);
  while (position + 46 <= archive.length && archive.readUInt32LE(position) === 0x02014b50) {
    const nameLength = archive.readUInt16LE(position + 28);
    const extraLength = archive.readUInt16LE(position + 30);
    const commentLength = archive.readUInt16LE(position + 32);
    const start = position + 46;
    names.push(archive.subarray(start, start + nameLength).toString("utf8"));
    position = start + nameLength + extraLength + commentLength;
  }
  return names;
}
