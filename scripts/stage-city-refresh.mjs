// Prepare a complete, reviewable local batch of city-cache replacements.
// This script reads R2 and Overpass, but never uploads or otherwise mutates R2.
//
//   node --env-file=.env.local scripts/stage-city-refresh.mjs --group=Demo
//   node --env-file=.env.local scripts/stage-city-refresh.mjs --group=Demo --stage-dir=.cell-refresh-staging/demo-review
//   node --env-file=.env.local scripts/stage-city-refresh.mjs --group=Demo --place=Edinburgh
//   node --env-file=.env.local scripts/stage-city-refresh.mjs --group=Demo --key=wtw_city6_55.956_-3.188
//   node --env-file=.env.local scripts/stage-city-refresh.mjs --place="New York" --allow-out-of-group-key --key=wtw_city6_40.758_-73.975
//   node --env-file=.env.local scripts/stage-city-refresh.mjs --place="New York" --allow-out-of-group-key --stage-new-cell --key=wtw_city6_40.758_-73.975
//
// Without R2 credentials, set NEXT_PUBLIC_R2_PUBLIC_BASE to a public city
// cache URL (for example, a deployment's /r2-public path) for read-only inputs.
//
// A ready batch contains candidates/ and manifest.json; refresh stages also
// contain originals/. A batch with any failed cell is incomplete and must not be applied.

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
import { countRefreshBuildings } from "./city-refresh-rules.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/"/g, "") : fallback;
};
const GROUP = opt("group", "Demo");
const PLACE = opt("place", "").trim();
const KEY = opt("key", "").trim();
const ALLOW_OUT_OF_GROUP_KEY = args.includes("--allow-out-of-group-key");
const STAGE_NEW_CELL = args.includes("--stage-new-cell");
const TIMEOUT_S = Number(opt("timeout", 240)) || 240;
const CONC = Math.max(1, Number(opt("conc", 1)) || 1);
const PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE?.replace(/\/+$/u, "") || "";
const STAGE_DIR = path.resolve(opt(
  "stage-dir",
  path.join(".cell-refresh-staging", `demo-${new Date().toISOString().replace(/[:.]/g, "-")}`),
));

if (!isConfigured() && !PUBLIC_BASE) {
  console.error("Missing R2_* env and NEXT_PUBLIC_R2_PUBLIC_BASE. A public base is sufficient for read-only staging.");
  process.exit(1);
}

const GROUPS = { Demo: DEMO_PLACES, "Fast travel": PLACES, ...SEED_GROUPS };
const groupPlaces = GROUPS[GROUP];
if (!groupPlaces) {
  console.error(`Unknown group "${GROUP}". Groups: ${Object.keys(GROUPS).join(", ")}`);
  process.exit(1);
}
const places = PLACE ? groupPlaces.filter((place) => place.name.toLowerCase() === PLACE.toLowerCase()) : groupPlaces;
if (PLACE && !places.length) {
  console.error(`Unknown place "${PLACE}" in group "${GROUP}". Places: ${groupPlaces.map((place) => place.name).join(", ")}`);
  process.exit(1);
}

const allCells = new Map();
for (const place of places) {
  for (const [lat, lon] of cellNeighborhood(place.lat, place.lon)) {
    const key = cityCacheKey(lat, lon);
    if (!allCells.has(key)) allCells.set(key, place.name);
  }
}
if (KEY && !parseCityKey(KEY)) {
  console.error(`Invalid city key "${KEY}"`);
  process.exit(1);
}
if (STAGE_NEW_CELL && !KEY) {
  console.error("--stage-new-cell requires --key=<city-cache-key> so the candidate is reviewed one cell at a time.");
  process.exit(1);
}
const keyIsOutOfGroup = !!KEY && !allCells.has(KEY);
if (keyIsOutOfGroup && !ALLOW_OUT_OF_GROUP_KEY) {
  console.error(`City key "${KEY}" is outside the selected group; pass --allow-out-of-group-key to stage a one-off cell.`);
  process.exit(1);
}
const STAGE_GROUP = keyIsOutOfGroup ? "Custom" : GROUP;
const cells = KEY
  ? new Map([[KEY, allCells.get(KEY) || PLACE || "Custom"]])
  : allCells;

const hash = (text) => createHash("sha256").update(text).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readStored(key) {
  for (let attempt = 1; ; attempt++) {
    try {
      if (isConfigured()) return await downloadObjectRaw(`${key}.json`);
      const response = await fetch(`${PUBLIC_BASE}/${encodeURIComponent(key)}.json`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Public city-cache request returned HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
      return { bytes, gzip, trusted: false };
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
  group: STAGE_GROUP,
  placeFilter: PLACE || null,
  cellFilter: KEY || null,
  createdAt: new Date().toISOString(),
  status: "in_progress",
  totalCells: cells.size,
  readyCells: 0,
  failedCells: 0,
  cells: [...cells].map(([key, place]) => ({ key, place, action: STAGE_NEW_CELL ? "create" : "refresh", state: "pending" })),
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
    let oldText = null;
    let oldData = null;
    if (STAGE_NEW_CELL) {
      if (stored) throw new Error("An R2 object already exists; use refresh mode");
    } else {
      if (!stored) throw new Error("No existing R2 object to refresh");
      oldText = (stored.gzip ? gunzipSync(stored.bytes) : stored.bytes).toString("utf8");
      oldData = JSON.parse(oldText);
      if (!isCompleteCity(oldData)) throw new Error("Existing R2 object is not a complete city cell");
    }

    const candidate = await fetchCell(entry.key);
    const beforeBuildings = oldData ? countRefreshBuildings(oldData) : null;
    const afterBuildings = countRefreshBuildings(candidate);
    const retainedEnoughBuildings = !oldData || afterBuildings >= beforeBuildings * 0.9;
    const carriedEnrichment = !!oldData?.enrichment && !candidate.enrichment;
    if (carriedEnrichment) candidate.enrichment = oldData.enrichment;

    const candidateText = JSON.stringify(candidate);
    if (Buffer.byteLength(candidateText, "utf8") > MAX_CITY_BYTES) {
      throw new Error(`Candidate exceeds ${MAX_CITY_BYTES} bytes`);
    }
    if (!isCompleteCity(JSON.parse(candidateText))) throw new Error("Candidate failed complete-cell validation");

    if (oldText !== null) writeFileSync(path.join(STAGE_DIR, "originals", `${entry.key}.json`), oldText);
    writeFileSync(path.join(STAGE_DIR, "candidates", `${entry.key}.json`), candidateText);
    entry.action = oldData ? "refresh" : "create";
    entry.state = "ready";
    if (oldText !== null) entry.originalSha256 = hash(oldText);
    entry.candidateSha256 = hash(candidateText);
    if (oldData) entry.originalElements = oldData.elements.length;
    entry.candidateElements = candidate.elements.length;
    if (oldData) entry.originalBuildings = beforeBuildings;
    entry.candidateBuildings = afterBuildings;
    entry.enrichmentCarried = carriedEnrichment;
    if (oldData && !retainedEnoughBuildings) {
      throw new Error(`Building count dropped from ${beforeBuildings} to ${afterBuildings} (minimum 90%); candidate saved for review`);
    }
  } catch (error) {
    entry.state = "failed";
    entry.error = error?.message || String(error);
    console.log(`✗ ${entry.place.padEnd(12)} ${entry.key}: ${entry.error}`);
  }

  manifest.readyCells = manifest.cells.filter((cell) => cell.state === "ready").length;
  manifest.failedCells = manifest.cells.filter((cell) => cell.state === "failed").length;
  saveManifest();
  if (entry.state === "ready") {
    const summary = entry.action === "create"
      ? `${entry.candidateBuildings} new renderable ways, ${entry.candidateElements} elements`
      : `${entry.originalBuildings} -> ${entry.candidateBuildings} renderable ways, ${entry.originalElements} -> ${entry.candidateElements} elements`;
    console.log(`✓ ${entry.place.padEnd(12)} ${entry.key}: ${summary}`);
  }
}

mkdirSync(path.dirname(STAGE_DIR), { recursive: true });
mkdirSync(STAGE_DIR, { recursive: false });
mkdirSync(path.join(STAGE_DIR, "originals"));
mkdirSync(path.join(STAGE_DIR, "candidates"));
saveManifest();
const markInterrupted = (signal) => {
  if (manifest.status === "in_progress") {
    manifest.status = "incomplete";
    manifest.interruptedAt = new Date().toISOString();
    manifest.interruptionSignal = signal;
    saveManifest();
    console.error(`\nStaging interrupted by ${signal}; saved an incomplete manifest at ${STAGE_DIR}`);
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
};
process.once("SIGINT", () => markInterrupted("SIGINT"));
process.once("SIGTERM", () => markInterrupted("SIGTERM"));
console.log(`${STAGE_GROUP}${PLACE ? ` / ${PLACE}` : ""}${KEY ? ` / ${KEY}` : ""}: ${KEY ? 1 : places.length} place(s), ${cells.size} unique cell(s); staging only, R2 writes disabled`);
const queue = manifest.cells.slice();
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) await stageCell(queue.shift());
}));

manifest.status = manifest.failedCells === 0 && manifest.readyCells === manifest.totalCells ? "ready" : "incomplete";
manifest.completedAt = new Date().toISOString();
saveManifest();
console.log(`\n${manifest.status}: ${manifest.readyCells}/${manifest.totalCells} cells staged at ${STAGE_DIR}`);
if (manifest.status !== "ready") process.exitCode = 1;
