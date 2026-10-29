import { decodePrebuiltCell } from "./prebuilt-cell-decoder";
import { cityCacheKey } from "../city-contract";
import { prebuiltCellOverlapsOwnedCell } from "./prebuilt-cell-overlap-index";

const INDEX_FORMAT = "walk-the-world-prebuilt-cell-index";
const EXPECTED_BUILDER_REVISION = process.env.NEXT_PUBLIC_PREBUILT_CELL_BUILDER_REVISION || "";
const EXPECTED_MATERIAL_REVISION = process.env.NEXT_PUBLIC_PREBUILT_CELL_MATERIAL_REVISION || "";

function validIndex(value) {
  return value?.format === INDEX_FORMAT && value.version === 1 &&
    typeof value.builderRevision === "string" && typeof value.materialRevision === "string" &&
    value.cells && typeof value.cells === "object" && !Array.isArray(value.cells);
}

function equalOrigin(a, b) {
  return Number.isFinite(a?.lat) && Number.isFinite(a?.lon) &&
    Number.isFinite(b?.lat) && Number.isFinite(b?.lon) &&
    Math.abs(a.lat - b.lat) < 1e-8 && Math.abs(a.lon - b.lon) < 1e-8;
}

function originMatchesKey(origin, key) {
  try {
    return cityCacheKey(origin?.lat, origin?.lon) === key;
  } catch {
    return false;
  }
}

function validTerrainSummary(entry) {
  return Number.isInteger(entry?.terrainZoom) && entry.terrainZoom >= 0 &&
    Array.isArray(entry.terrainTileKeys) && entry.terrainTileKeys.length > 0 &&
    entry.terrainTileKeys.length <= 64 && entry.terrainTileKeys.every((key) => /^\d+\/\d+$/u.test(key));
}

function terrainSummaryMatches(metadata, entry) {
  if (entry.terrainZoom === undefined && entry.terrainTileKeys === undefined) return true;
  return validTerrainSummary(entry) && metadata.terrainZoom === entry.terrainZoom &&
    metadata.terrainTileKeys.length === entry.terrainTileKeys.length &&
    metadata.terrainTileKeys.every((key, index) => key === entry.terrainTileKeys[index]);
}

function metadataMatchesEntry(metadata, entry, key) {
  return metadata?.key === key && metadata.clipMode === "spawn-cell-v1" &&
    /^[0-9a-f]{64}$/u.test(metadata.sourceHash || "") &&
    /^[0-9a-f]{64}$/u.test(metadata.builderRevision || "") &&
    /^[0-9a-f]{64}$/u.test(metadata.terrainRevision || "") &&
    typeof metadata.materialRevision === "string" &&
    Number.isInteger(metadata.terrainZoom) && metadata.terrainZoom >= 0 &&
    Number.isInteger(metadata.clippedElementCount) && metadata.clippedElementCount > 0 &&
    Number.isInteger(metadata.elementCount) && metadata.elementCount >= metadata.clippedElementCount &&
    metadata.sourceHash === entry.sourceHash &&
    metadata.builderRevision === entry.builderRevision &&
    metadata.materialRevision === entry.materialRevision &&
    metadata.terrainRevision === entry.terrainRevision &&
    metadata.editorRevision === entry.editorRevision &&
    terrainSummaryMatches(metadata, entry) &&
    equalOrigin(metadata.origin, entry.origin) &&
    Array.isArray(metadata.terrainTileKeys) && metadata.terrainTileKeys.length > 0 &&
    metadata.terrainTileKeys.length <= 64 && metadata.terrainTileKeys.every((key) => /^\d+\/\d+$/u.test(key)) &&
    Array.isArray(metadata.featureIds) && metadata.featureIds.length === metadata.clippedElementCount &&
    metadata.featureIds.every((id) => /^[a-z]+\/-?\d+$/u.test(id)) &&
    metadata.summary && typeof metadata.summary === "object" && originMatchesKey(metadata.origin, key);
}

function validBuiltResult(result) {
  const metadataArrays = ["roadPaths", "buildingRings", "roadPoints", "props", "stations", "bridges", "rails",
    "barrierWays", "powerLines", "waterways", "crossings", "pois", "footprints"];
  return !!result && typeof result === "object" &&
    Array.isArray(result.walls) && Array.isArray(result.roofCaps) &&
    Array.isArray(result.pitchedRoofs) && Array.isArray(result.roadDecals) &&
    Array.isArray(result.flats) && result.meta && typeof result.meta === "object" &&
    metadataArrays.every((key) => Array.isArray(result.meta[key]));
}

// Roots whose index.json answered 404, per fetch implementation. Without this,
// a deploy with no published artifacts re-requests the index for every cell.
const missingIndexRoots = new WeakMap();

function normalizeBase(base) {
  return String(base || "/prebuilt-cells").replace(/\/+$/u, "");
}

/** Fetch and validate a cell; null means unavailable, while raw-fallback is an indexed ownership skip. */
export async function fetchPrebuiltCell(key, {
  signal,
  base = process.env.NEXT_PUBLIC_PREBUILT_CELL_BASE || "/prebuilt-cells",
  expectedBuilderRevision = EXPECTED_BUILDER_REVISION,
  expectedMaterialRevision = EXPECTED_MATERIAL_REVISION,
  fetchImpl = globalThis.fetch,
  decode = decodePrebuiltCell,
  getOwnedCellKeys,
  validateEntry,
} = {}) {
  if (typeof fetchImpl !== "function" || !expectedBuilderRevision || !expectedMaterialRevision) return null;
  const root = normalizeBase(base);
  if (missingIndexRoots.get(fetchImpl)?.has(root)) return null;
  try {
    const indexResponse = await fetchImpl(`${root}/index.json`, { signal, cache: "force-cache" });
    if (indexResponse.status === 404) {
      if (!missingIndexRoots.has(fetchImpl)) missingIndexRoots.set(fetchImpl, new Set());
      missingIndexRoots.get(fetchImpl).add(root);
    }
    if (!indexResponse.ok) return null;
    const index = await indexResponse.json();
    if (!validIndex(index) || index.builderRevision !== expectedBuilderRevision ||
        index.materialRevision !== expectedMaterialRevision) return null;
    const entry = index.cells[key];
    if (!entry || entry.builderRevision !== expectedBuilderRevision ||
        entry.materialRevision !== expectedMaterialRevision || entry.editorRevision !== "unmodified" ||
        typeof entry.file !== "string" || !entry.file.startsWith(`${key}.`) ||
        !entry.file.endsWith(".wtwc.gz") || /[\\/]/u.test(entry.file)) return null;

    if (typeof getOwnedCellKeys === "function" &&
        prebuiltCellOverlapsOwnedCell(entry, key, getOwnedCellKeys())) {
      return { kind: "raw-fallback", reason: "feature-id-overlap" };
    }

    const response = await fetchImpl(`${root}/${entry.file}`, { signal, cache: "force-cache" });
    if (!response.ok) return null;
    const entryValidationPromise = typeof validateEntry === "function" && validTerrainSummary(entry)
      ? Promise.resolve().then(() => validateEntry(entry)).then(
          (result) => typeof result === "boolean" ? result : null,
          () => false
        )
      : null;
    const [arrayBuffer, terrainValidated] = await Promise.all([
      response.arrayBuffer(),
      entryValidationPromise || Promise.resolve(null),
    ]);
    const decoded = await decode(new Uint8Array(arrayBuffer));
    if (!metadataMatchesEntry(decoded?.metadata, entry, key) || !validBuiltResult(decoded?.result)) return null;
    return {
      kind: "prebuilt",
      metadata: decoded.metadata,
      result: decoded.result,
      file: entry.file,
      ...(terrainValidated === null ? {} : { terrainValidated }),
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    return null;
  }
}
