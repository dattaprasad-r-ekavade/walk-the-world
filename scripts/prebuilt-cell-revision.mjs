import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const PREBUILT_BUILDER_INPUTS = Object.freeze([
  "lib/city-contract.js",
  "lib/engine/city-builder-core.js",
  "lib/engine/cell-enrichment.js",
  "lib/engine/road-markings.js",
  "lib/engine/styles.js",
  "lib/engine/geo.js",
  "lib/engine/street/constants.js",
  "lib/engine/street/ground-height.js",
  "lib/engine/street/terrain-grid.js",
  "lib/engine/facade-uv.js",
  "lib/engine/roof-geometry.js",
  "lib/engine/cell-clip.js",
  "lib/engine/ground-surfaces.js",
]);

export function readThreeVersion(root) {
  return JSON.parse(readFileSync(path.join(root, "node_modules", "three", "package.json"), "utf8")).version;
}

export function readMaterialRevision(root) {
  const manifestPath = path.join(root, "public", "textures", "ktx2", "runtime-manifest.json");
  return existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8")).revision || ""
    : "";
}

export function computePrebuiltBuilderRevision(root, threeVersion = readThreeVersion(root)) {
  const hash = createHash("sha256").update(`three=${threeVersion}\n`);
  for (const relative of PREBUILT_BUILDER_INPUTS) {
    hash.update(relative).update("\n").update(readFileSync(path.join(root, relative)));
  }
  return hash.digest("hex");
}
