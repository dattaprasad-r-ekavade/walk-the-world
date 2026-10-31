// Prepare a complete, reviewable local batch of city-cache replacements.
// This script reads R2 and Overpass, but never uploads or otherwise mutates R2.
//
//   node --env-file=.env.local scripts/stage-city-refresh.mjs --group=Demo
//   node --env-file=.env.local scripts/stage-city-refresh.mjs --group=Demo --stage-dir=.cell-refresh-staging/demo-review
//
// A ready batch contains originals/, candidates/, and manifest.json. A batch
// with any failed cell is marked incomplete and must not be applied.

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  cityCacheKey,
  cellNeighborhood,
  isCompleteCity,
  MAX_CITY_BYTES,
  parseCityKey,
} from "../lib/city-contract.js";
import { DEMO_PLACES, PLACES } from "../lib/geo.js";
import { SEED_GROUPS } from "../lib/seedPlaces.js";
import { fetchOverpassCell } from "../lib/overpassServer.js";
import { downloadObjectRaw, isConfigured } from "../lib/r2Server.js";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/"/g, "") : fallback;
};
const GROUP = opt("group", "Demo");
const TIMEOUT_S = Number(opt("timeout", 240)) || 240;
const CONC = Math.max(1, Number(opt("conc", 1)) || 1);
const STAGE_DIR = path.resolve(opt(
  "stage-dir",
  path.join(".cell-refresh-staging", `demo-${new Date().toISOString().replace(/[:.]/g, "-")}`),
));

if (!isConfigured()) {
  console.error("Missing R2_* env. Run with: node --env-file=.env.local scripts/stage-city-refresh.mjs");
  process.exit(1);
}

const GROUPS = { Demo: DEMO_PLACES, "Fast travel": PLACES, ...SEED_GROUPS };
const places = GROUPS[GROUP];
if (!places) {
  console.error(`Unknown group "${GROUP}". Groups: ${Object.keys(GROUPS).join(", ")}`);
  process.exit(1);
}

const cells = new Map();
for (const place of places) {
  for (const [lat, lon] of cellNeighborhood(place.lat, place.lon)) {
    const key = cityCacheKey(lat, lon);
    if (!cells.has(key)) cells.set(key, place.name);
  }
}

const hash = (text) => createHash("sha256").update(text).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const countBuildings = (data) => (data?.elements || []).filter((element) => element.tags?.building).length;

async function readStored(key) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadObjectRaw(`${key}.json`);
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(2000);
    }
  }
}

async function fetchCell(key) {
  const coordinates = parseCityKey(key);
  if (!coordinates) throw new Error(`Invalid city key: ${key}`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = await fetchOverpassCell(coordinates.lat, coordinates.lon, {
        timeoutMs: TIMEOUT_S * 1000,
        rounds: 8,
        backoffMs: 8000,
      });
      if (isCompleteCity(data)) return data;
      console.log(`  ${key}: partial result (${data.elements?.length ?? 0} elements), retrying`);
    } catch (error) {
      console.log(`  ${key}: attempt ${attempt} failed: ${error?.message || error}`);
    }
    if (attempt < 2) await sleep(15000);
  }
  throw new Error("No complete Overpass result after two attempts");
}

const manifest = {
  schemaVersion: 1,
  group: GROUP,
  createdAt: new Date().toISOString(),
  status: "in_progress",
  totalCells: cells.size,
  readyCells: 0,
  failedCells: 0,
  cells: [...cells].map(([key, place]) => ({ key, place, state: "pending" })),
};

function saveManifest() {
  const manifestPath = path.join(STAGE_DIR, "manifest.json");
  const tempPath = `${manifestPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // Replacing a local manifest is atomic on the same volume.
  renameSync(tempPath, manifestPath);
}

async function stageCell(entry) {
  try {
    const stored = await readStored(entry.key);
    if (!stored) throw new Error("No existing R2 object to refresh");
    const oldText = (stored.gzip ? gunzipSync(stored.bytes) : stored.bytes).toString("utf8");
    const oldData = JSON.parse(oldText);
    if (!isCompleteCity(oldData)) throw new Error("Existing R2 object is not a complete city cell");

    const candidate = await fetchCell(entry.key);
    const beforeBuildings = countBuildings(oldData);
    const afterBuildings = countBuildings(candidate);
    if (afterBuildings < beforeBuildings * 0.9) {
      throw new Error(`Building count dropped from ${beforeBuildings} to ${afterBuildings} (minimum 90%)`);
    }
    const carriedEnrichment = !!oldData.enrichment && !candidate.enrichment;
    if (carriedEnrichment) candidate.enrichment = oldData.enrichment;

    const candidateText = JSON.stringify(candidate);
    if (Buffer.byteLength(candidateText, "utf8") > MAX_CITY_BYTES) {
      throw new Error(`Candidate exceeds ${MAX_CITY_BYTES} bytes`);
    }
    if (!isCompleteCity(JSON.parse(candidateText))) throw new Error("Candidate failed complete-cell validation");

    writeFileSync(path.join(STAGE_DIR, "originals", `${entry.key}.json`), oldText);
    writeFileSync(path.join(STAGE_DIR, "candidates", `${entry.key}.json`), candidateText);
    entry.state = "ready";
    entry.originalSha256 = hash(oldText);
    entry.candidateSha256 = hash(candidateText);
    entry.originalElements = oldData.elements.length;
    entry.candidateElements = candidate.elements.length;
    entry.originalBuildings = beforeBuildings;
    entry.candidateBuildings = afterBuildings;
    entry.enrichmentCarried = carriedEnrichment;
  } catch (error) {
    entry.state = "failed";
    entry.error = error?.message || String(error);
    console.log(`✗ ${entry.place.padEnd(12)} ${entry.key}: ${entry.error}`);
  }

  manifest.readyCells = manifest.cells.filter((cell) => cell.state === "ready").length;
  manifest.failedCells = manifest.cells.filter((cell) => cell.state === "failed").length;
  saveManifest();
  if (entry.state === "ready") {
    console.log(`✓ ${entry.place.padEnd(12)} ${entry.key}: ${entry.originalBuildings} -> ${entry.candidateBuildings} buildings`);
  }
}

mkdirSync(path.dirname(STAGE_DIR), { recursive: true });
mkdirSync(STAGE_DIR, { recursive: false });
mkdirSync(path.join(STAGE_DIR, "originals"));
mkdirSync(path.join(STAGE_DIR, "candidates"));
saveManifest();
console.log(`${GROUP}: ${places.length} places, ${cells.size} unique cells; staging only, R2 writes disabled`);
const queue = manifest.cells.slice();
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) await stageCell(queue.shift());
}));

manifest.status = manifest.failedCells === 0 && manifest.readyCells === manifest.totalCells ? "ready" : "incomplete";
manifest.completedAt = new Date().toISOString();
saveManifest();
console.log(`\n${manifest.status}: ${manifest.readyCells}/${manifest.totalCells} cells staged at ${STAGE_DIR}`);
if (manifest.status !== "ready") process.exitCode = 1;
