#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createServer } from "vite";
import { encodePrebuiltCell } from "../lib/engine/prebuilt-cell-encoder.js";
import { buildPrebuiltCellOverlapIndex } from "../lib/engine/prebuilt-cell-overlap-index.js";
import { computePrebuiltBuilderRevision, readMaterialRevision } from "./prebuilt-cell-revision.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.join(ROOT, "public", "prebuilt-cells");
const DEFAULT_TERRAIN_CACHE = path.join(os.tmpdir(), "walk-the-world-prebuilt-terrain-z14");
const TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

function parseArgs(argv) {
  const args = { inputDir: null, outputDir: DEFAULT_OUTPUT, terrainCacheDir: DEFAULT_TERRAIN_CACHE, key: null, origin: null, help: false };
  for (const value of argv) {
    if (value === "--help" || value === "-h") args.help = true;
    else if (value.startsWith("--input-dir=")) args.inputDir = value.slice("--input-dir=".length);
    else if (value.startsWith("--out-dir=")) args.outputDir = value.slice("--out-dir=".length);
    else if (value.startsWith("--terrain-cache-dir=")) args.terrainCacheDir = value.slice("--terrain-cache-dir=".length);
    else if (value.startsWith("--key=")) args.key = value.slice("--key=".length);
    else if (value.startsWith("--origin=")) {
      const parts = value.slice("--origin=".length).split(",").map(Number);
      if (parts.length !== 2 || !parts.every(Number.isFinite)) throw new Error("--origin must be LAT,LON");
      args.origin = { lat: parts[0], lon: parts[1] };
    } else if (value.startsWith("--")) throw new Error(`Unknown option: ${value}`);
    else if (!args.inputDir) args.inputDir = value;
    else throw new Error(`Unexpected argument: ${value}`);
  }
  return args;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readTerrainTile({ tx, ty, zoom, cacheDir, localFrame, decodeTerrariumHeightGrid, terrainTileLocalBounds }) {
  const cachePath = path.join(cacheDir, `${zoom}-${tx}-${ty}.png`);
  let bytes;
  if (existsSync(cachePath)) bytes = readFileSync(cachePath);
  else {
    const response = await fetch(`${TERRAIN_URL}/${zoom}/${tx}/${ty}.png`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Terrarium tile ${tx}/${ty} returned HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, bytes);
  }

  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 256 || info.height !== 256 || info.channels !== 4) {
    throw new Error(`Terrarium tile ${tx}/${ty} has unexpected dimensions or channels`);
  }
  const { x0, z0, sizeX, sizeZ } = terrainTileLocalBounds(tx, ty, zoom, localFrame.toLocal);
  return {
    key: `${tx}/${ty}`,
    heights: decodeTerrariumHeightGrid(data, info.width, info.height),
    n: 65,
    x0,
    z0,
    sizeX,
    sizeZ,
    sourceBytes: bytes,
  };
}

async function bakeOne({ key, inputDir, outputDir, terrainCacheDir, origin }, api) {
  const { cityCacheKey, parseCityKey, validCityData, isCompleteCity, cellStep, terrainZoom,
    makeLocalFrame, terrainTileKeysForCell, terrainTileLocalBounds, decodeTerrariumHeightGrid,
    terrainRevisionChunks, clipElementsToCell, applyCellEnrichment, buildCityGeometry,
    summarizeCityElements, encodePrebuiltCell,
  } = api;
  const coords = parseCityKey(key);
  if (!coords) throw new Error(`Invalid city key: ${key}`);
  const bakedOrigin = origin || coords;
  if (cityCacheKey(bakedOrigin.lat, bakedOrigin.lon) !== key) {
    throw new Error(`Origin ${bakedOrigin.lat},${bakedOrigin.lon} does not belong to ${key}`);
  }
  const sourcePath = path.join(inputDir, `${key}.json`);
  if (!existsSync(sourcePath)) throw new Error(`Missing source cell: ${sourcePath}`);
  const sourceBytes = readFileSync(sourcePath);
  const source = JSON.parse(sourceBytes.toString("utf8"));
  if (!validCityData(source) || !isCompleteCity(source)) throw new Error(`${key} is incomplete or invalid`);

  const localFrame = makeLocalFrame(bakedOrigin.lat, bakedOrigin.lon);
  const tileKeys = terrainTileKeysForCell(bakedOrigin.lat, bakedOrigin.lon, cellStep, terrainZoom, 1);
  const terrainTiles = [];
  for (const tileKey of tileKeys) {
    const [tx, ty] = tileKey.split("/").map(Number);
    terrainTiles.push(await readTerrainTile({
      tx, ty, zoom: terrainZoom, cacheDir: terrainCacheDir, localFrame,
      decodeTerrariumHeightGrid, terrainTileLocalBounds,
    }));
  }

  const enriched = applyCellEnrichment(source);
  const elements = clipElementsToCell(enriched.elements, bakedOrigin.lat, bakedOrigin.lon);
  if (!elements.length) throw new Error(`${key} has no features in the requested spawn cell`);
  const buildStartedAt = performance.now();
  const { result } = buildCityGeometry({
    elements,
    lat0: bakedOrigin.lat,
    lon0: bakedOrigin.lon,
    terrainTiles,
  });
  const buildMs = performance.now() - buildStartedAt;
  const terrainHash = createHash("sha256");
  for (const chunk of terrainRevisionChunks(terrainTiles)) terrainHash.update(chunk);
  const terrainRevision = terrainHash.digest("hex");
  const metadata = {
    key,
    origin: bakedOrigin,
    clipMode: "spawn-cell-v1",
    sourceHash: sha256(sourceBytes),
    builderRevision: api.builderRevision,
    threeVersion: api.threeVersion,
    materialRevision: api.materialRevision,
    terrainRevision,
    terrainZoom,
    terrainTileKeys: tileKeys,
    editorRevision: "unmodified",
    elementCount: enriched.elements.length,
    clippedElementCount: elements.length,
    featureIds: elements.map((element) => `${element.type}/${element.id}`),
    summary: summarizeCityElements(enriched.elements),
  };
  const encodeStartedAt = performance.now();
  const bytes = await encodePrebuiltCell({ metadata, result });
  const encodeMs = performance.now() - encodeStartedAt;
  const materialRevision = metadata.materialRevision || "none";
  const output = `${key}.s${metadata.sourceHash.slice(0, 12)}.b${metadata.builderRevision.slice(0, 12)}.m${materialRevision.slice(0, 8)}.t${terrainRevision.slice(0, 12)}.e1.wtwc.gz`;
  const outputPath = path.join(outputDir, output);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, bytes);
  return {
    key,
    output,
    origin: bakedOrigin,
    materialRevision: metadata.materialRevision,
    builderRevision: metadata.builderRevision,
    editorRevision: metadata.editorRevision,
    sourceBytes: sourceBytes.byteLength,
    outputBytes: bytes.byteLength,
    outputToSourceRatio: Number((bytes.byteLength / sourceBytes.byteLength).toFixed(3)),
    sourceHash: metadata.sourceHash,
    terrainRevision: metadata.terrainRevision,
    terrainZoom,
    terrainTileKeys: tileKeys,
    featureIds: metadata.featureIds,
    clippedElementCount: elements.length,
    buildingCount: result.buildingCount,
    terrainTiles: terrainTiles.length,
    buildMs: Number(buildMs.toFixed(1)),
    encodeMs: Number(encodeMs.toFixed(1)),
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: npm run cells:bake -- --input-dir=DIR [--key=wtw_city6_LAT_LON] [--origin=LAT,LON] [--out-dir=DIR] [--terrain-cache-dir=DIR]\n" +
      "Reads raw city JSON cells, builds the canonical spawn cell with the shared city-builder-core and Terrarium heights, then writes a local .wtwc.gz artifact.\n" +
      `Default output: ${DEFAULT_OUTPUT}\nDefault terrain cache: ${DEFAULT_TERRAIN_CACHE}\n` +
      "An explicit origin is accepted only when its rounded city cache key matches the input key.");
    return 0;
  }
  if (!args.inputDir) throw new Error("--input-dir is required");
  args.inputDir = path.resolve(ROOT, args.inputDir);
  args.outputDir = path.resolve(ROOT, args.outputDir);
  args.terrainCacheDir = path.resolve(args.terrainCacheDir);
  if (!existsSync(args.inputDir)) throw new Error(`Input directory does not exist: ${args.inputDir}`);

  const vite = await createServer({
    configFile: path.join(ROOT, "vitest.config.js"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const [contract, geo, terrain, clip, enrichment, builder, worldRepair, encoder, streetConstants, threePackage] = await Promise.all([
      vite.ssrLoadModule("/lib/city-contract.js"),
      vite.ssrLoadModule("/lib/engine/geo.js"),
      vite.ssrLoadModule("/lib/engine/street/terrain-grid.js"),
      vite.ssrLoadModule("/lib/engine/cell-clip.js"),
      vite.ssrLoadModule("/lib/engine/cell-enrichment.js"),
      vite.ssrLoadModule("/lib/engine/city-builder-core.js"),
      vite.ssrLoadModule("/lib/world-repair.js"),
      vite.ssrLoadModule("/lib/engine/prebuilt-cell-encoder.js"),
      vite.ssrLoadModule("/lib/engine/street/constants.js"),
      JSON.parse(readFileSync(path.join(ROOT, "node_modules", "three", "package.json"), "utf8")),
    ]);
    const materialRevision = readMaterialRevision(ROOT);
    const api = {
      ...contract,
      ...geo,
      ...terrain,
      ...clip,
      ...enrichment,
      ...builder,
      ...worldRepair,
      ...encoder,
      cellStep: contract.CELL_STEP,
      terrainZoom: streetConstants.STREET.TERRAIN_Z,
      threeVersion: threePackage.version,
      materialRevision,
      builderRevision: computePrebuiltBuilderRevision(ROOT, threePackage.version),
    };
    const keys = args.key
      ? [args.key]
      : readdirSync(args.inputDir).filter((name) => /^wtw_city\d+_-?\d+\.\d{3}_-?\d+\.\d{3}\.json$/u.test(name))
        .map((name) => name.slice(0, -5)).sort();
    if (!keys.length) throw new Error("No city cell JSON files found in the input directory");

    const rows = [];
    for (const key of keys) {
      const row = await bakeOne({ ...args, key }, api);
      rows.push(row);
      console.log(`${row.key}: ${row.sourceBytes} B JSON → ${row.outputBytes} B prebuilt; ${row.clippedElementCount} clipped features; build ${row.buildMs} ms, encode ${row.encodeMs} ms`);
    }
    const report = {
      format: "walk-the-world-prebuilt-bake-report",
      formatVersion: 1,
      threeVersion: api.threeVersion,
      builderRevision: api.builderRevision,
      materialRevision: api.materialRevision,
      entries: rows.map(({ featureIds, terrainTileKeys, ...row }) => row),
    };
    writeFileSync(path.join(args.outputDir, "bake-report.json"), JSON.stringify(report, null, 2));
    const indexPath = path.join(args.outputDir, "index.json");
    let cells = {};
    if (existsSync(indexPath)) {
      try {
        const previous = JSON.parse(readFileSync(indexPath, "utf8"));
        if (previous?.format === "walk-the-world-prebuilt-cell-index" && previous.version === 1 &&
            previous.builderRevision === api.builderRevision && previous.materialRevision === api.materialRevision) {
          cells = previous.cells || {};
        }
      } catch { /* replace an invalid index with the current bake set */ }
    }
    const overlapKeysByCell = buildPrebuiltCellOverlapIndex(rows);
    for (const row of rows) {
      cells[row.key] = {
        file: row.output,
        sourceHash: row.sourceHash,
        builderRevision: row.builderRevision,
        materialRevision: row.materialRevision,
        terrainRevision: row.terrainRevision,
        terrainZoom: row.terrainZoom,
        terrainTileKeys: row.terrainTileKeys,
        editorRevision: row.editorRevision,
        origin: row.origin,
        featureOverlapKeys: overlapKeysByCell.get(row.key) || [],
      };
    }
    writeFileSync(indexPath, JSON.stringify({
      format: "walk-the-world-prebuilt-cell-index",
      version: 1,
      builderRevision: api.builderRevision,
      materialRevision: api.materialRevision,
      cells,
    }, null, 2));
    return 0;
  } finally {
    await vite.close();
  }
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
