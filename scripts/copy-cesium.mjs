// Copies CesiumJS static assets into public/cesium when
// NEXT_PUBLIC_CESIUM_BASE_URL=/cesium. By default the app loads these from a
// CDN instead, which keeps deploy artifacts much smaller.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.NEXT_PUBLIC_CESIUM_BASE_URL?.trim();

if (!baseUrl || baseUrl !== "/cesium") {
  console.log(
    "[copy-cesium] Skipping — Cesium loads from CDN (set NEXT_PUBLIC_CESIUM_BASE_URL=/cesium to bundle local assets)"
  );
  process.exit(0);
}

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
