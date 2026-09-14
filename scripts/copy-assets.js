import { cpSync, mkdirSync } from "fs";
import { join } from "path";

const dist = "dist";
mkdirSync(dist, { recursive: true });
mkdirSync(join(dist, "icons"), { recursive: true });

// Copy HTML/CSS from public
for (const f of ["manifest.json", "popup.html", "popup.css", "options.html", "options.css", "sidepanel.html", "sidepanel.css"]) {
  try {
    cpSync(join("public", f), join(dist, f));
  } catch (e) {
    console.warn("skip", f, e.message);
  }
}

// Icons are committed artwork, not generated output, so they are copied like every other asset.
// The store requires a real 128x128 PNG in the package; a 1x1 stub satisfies the manifest's path
// check while failing submission, which is the failure `tests/quality/manifest.spec.ts` now pins
// by reading each PNG's declared dimensions.
for (const size of [16, 32, 48, 128]) {
  try {
    cpSync(join("public", "icons", `icon${size}.png`), join(dist, "icons", `icon${size}.png`));
  } catch (e) {
    console.warn("skip", `icons/icon${size}.png`, e.message);
  }
}

console.log("Assets copied to dist/");
