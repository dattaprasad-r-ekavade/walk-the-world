// Copies CesiumJS static assets (Workers, Assets, Widgets, ThirdParty) into
// /public/cesium so they can be served at runtime. CesiumJS loads these at
// the path given by window.CESIUM_BASE_URL (set to "/cesium" in the app).
// Runs automatically before `dev` and `build` via npm pre-scripts.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "node_modules", "cesium", "Build", "Cesium");
const dest = join(root, "public", "cesium");

if (!existsSync(src)) {
  console.error(
    "[copy-cesium] Cesium build assets not found. Did you run `npm install`?"
  );
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const dir of ["Workers", "Assets", "Widgets", "ThirdParty"]) {
  const from = join(src, dir);
  if (existsSync(from)) {
    cpSync(from, join(dest, dir), { recursive: true });
  }
}
console.log("[copy-cesium] Cesium assets copied to public/cesium");
