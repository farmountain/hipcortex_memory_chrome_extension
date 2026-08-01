import { cpSync, mkdirSync, existsSync, writeFileSync } from "fs";
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

// Minimal PNG placeholders (1x1 transparent) — replace with real icons later
// For a real build you would use proper 16/32/48/128 PNGs.
// Here we write a tiny valid PNG header so the extension loads without 404s.
const minimalPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(dist, "icons", `icon${size}.png`), minimalPng);
}

console.log("Assets copied to dist/");
