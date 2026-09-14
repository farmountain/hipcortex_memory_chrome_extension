/**
 * Package `dist/` into a store-uploadable zip (task 1.10).
 *
 * The archive root holds `manifest.json` directly — a zip that nests everything under `dist/`
 * installs as a broken extension, which is the failure this layout avoids.
 *
 * The zip is written here rather than shelled out to a packer, because the archive a person uploads
 * has to be byte-conformant and a packer's behaviour is platform-dependent. `Compress-Archive` on
 * Windows PowerShell 5.1 writes entry names with `\` separators, which the ZIP specification does
 * not allow (APPNOTE 4.4.17.1 names `/` as the path separator) and which the previous version of
 * this script shipped to the release page: 148 of 148 entries. Names are built with `/` here, from
 * a relative path whose separator is normalised, so the archive is identical on every platform.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectFiles, createZip, storeSafeEntries } from "./zip.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

if (!existsSync(dist)) {
  console.error("[package] dist/ does not exist — run `npm run build` first");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const out = path.join(root, `hipcortex-chrome-extension-v${version}.zip`);

rmSync(out, { force: true });

// `key` pins the ID of the extension loaded from `dist/`, which is what the native host's
// `allowed_origins` names, so `dist/` keeps it. The store refuses the package when it is present, and
// the field is meaningless to a store-published item because the store assigns that ID itself.
const entries = storeSafeEntries(collectFiles(dist));

// The invariant is checked rather than trusted: a backslash in an entry name is the specific defect
// this script was rewritten to remove, and it must fail here rather than on the store's side.
const offenders = entries.filter((entry) => entry.name.includes("\\"));
if (offenders.length > 0) {
  console.error(`[package] ${offenders.length} entry name(s) contain a backslash: ${offenders[0].name}`);
  process.exit(1);
}
if (!entries.some((entry) => entry.name === "manifest.json")) {
  console.error("[package] manifest.json is not at the archive root; the store rejects that layout");
  process.exit(1);
}

// Checked for the same reason, and because the failure it prevents is a message from the store's
// validator rather than a broken extension: the upload is simply refused, with no local symptom.
const archived = entries.find((entry) => entry.name === "manifest.json");
if ("key" in JSON.parse(archived.content.toString("utf8"))) {
  console.error("[package] the archived manifest still carries `key`; the store rejects the package");
  process.exit(1);
}

writeFileSync(out, createZip(entries));

console.log(`[package] wrote ${path.basename(out)} (${entries.length} entries)`);

