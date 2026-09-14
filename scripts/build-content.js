/**
 * Bundle the content script (task 6.16).
 *
 * The content script cannot use the `tsc` output: `tsc` emits ES modules, and a content script must
 * be a single classic script with no top-level `import`/`export` (the manifest injects it as
 * `js: ["content.js"]`, not as a module). So this step bundles `src/content/entry.ts` into one IIFE.
 *
 * It is a separate step rather than a second `tsconfig` so that the extension keeps the "no bundler
 * for the extension itself" property, and so `dist/content.js` is the only bundled artefact.
 * Not minified on purpose: the packaged extension ships a file a reviewer can read.
 */

import { build } from "esbuild";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "src", "content", "entry.ts")],
  outfile: join(root, "dist", "content.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome116",
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});

console.log("[build-content] wrote dist/content.js");
