// Seed the R2 city cache straight from this machine: Overpass -> R2, with no
// Vercel function limit in between. Slow public Overpass answers get minutes
// instead of the API route's 85 s budget, and stored cells are skipped with a
// direct R2 lookup (no app round trip).
//
//   node --env-file=.env.local scripts/seed-direct.mjs                  # demo cities
//   node --env-file=.env.local scripts/seed-direct.mjs --group="Fast travel"
//   node --env-file=.env.local scripts/seed-direct.mjs --upgrade        # also re-mark legacy entries
//
//   --group=name   DEMO (default), "Fast travel" or a SEED_GROUPS key
//   --timeout=s    per-cell Overpass budget in seconds (default 240)
//   --conc=n       cells fetched in parallel (default 1; be polite to Overpass)
//   --upgrade      re-upload valid legacy objects with the `complete` marker so
//                  the API can stream their gzip bytes untouched
//   --dry          report stored/missing cells only
//   --refresh      re-fetch stored cells too (e.g. after the Overpass query
//                  gains tags). Each old object is backed up to --backup-dir
//                  (default .cell-backups/<timestamp>) first, its enrichment
//                  block is carried over, and it is only replaced when the new
//                  answer is complete and keeps at least 90% of its buildings.
import { cityCacheKey, cellNeighborhood, isCompleteCity, parseCityKey } from "../lib/city-contract.js";
import { DEMO_PLACES, PLACES } from "../lib/geo.js";
import { SEED_GROUPS } from "../lib/seedPlaces.js";
import { fetchOverpassCell } from "../lib/overpassServer.js";
import { isConfigured, downloadObjectRaw, uploadObject } from "../lib/r2Server.js";
import { gunzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/"/g, "") : fallback;
};
const GROUP = opt("group", "Demo");
const TIMEOUT_S = Number(opt("timeout", 240)) || 240;
const CONC = Math.max(1, Number(opt("conc", 1)) || 1);
const UPGRADE = args.includes("--upgrade");
const DRY = args.includes("--dry");
const REFRESH = args.includes("--refresh");
const BACKUP_DIR = opt("backup-dir", path.join(".cell-backups", new Date().toISOString().replace(/[:.]/g, "-")));

if (!isConfigured()) {
  console.error("Missing R2_* env. Run with: node --env-file=.env.local scripts/seed-direct.mjs");
  process.exit(1);
}

const GROUPS = { Demo: DEMO_PLACES, "Fast travel": PLACES, ...SEED_GROUPS };
const places = GROUPS[GROUP];
if (!places) {
  console.error(`Unknown group "${GROUP}". Groups: ${Object.keys(GROUPS).join(", ")}`);
  process.exit(1);
}

const cells = new Map();
for (const p of places) {
  for (const [la, lo] of cellNeighborhood(p.lat, p.lon)) {
    const key = cityCacheKey(la, lo);
    if (!cells.has(key)) cells.set(key, p.name);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

// stored-trusted | stored-legacy | missing
async function readStored(key) {
  // The first R2 call pays TLS/connection setup and can trip the 8 s read timeout.
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadObjectRaw(`${key}.json`);
    } catch (error) {
      if (attempt >= 3) throw error;
      await sleep(2000);
    }
  }
}

const countBuildings = (data) => (data?.elements || []).filter((e) => e.tags?.building).length;

async function refreshCell(key, name, stored, t0) {
  const oldText = (stored.gzip ? gunzipSync(stored.bytes) : stored.bytes).toString("utf8");
  const old = JSON.parse(oldText);
  mkdirSync(BACKUP_DIR, { recursive: true });
  writeFileSync(path.join(BACKUP_DIR, `${key}.json`), oldText);
  const data = await fetchCell(key);
  if (!data) {
    results.failed.push(key);
    return console.log(`✗ ${name.padEnd(12)} ${key} refresh failed after ${secs(t0)}; kept the stored cell`);
  }
  const before = countBuildings(old), after = countBuildings(data);
  if (after < before * 0.9) {
    results.failed.push(key);
    return console.log(`✗ ${name.padEnd(12)} ${key} refresh has ${after} buildings vs ${before}; kept the stored cell`);
  }
  if (old.enrichment && !data.enrichment) data.enrichment = old.enrichment;
  await uploadObject(`${key}.json`, JSON.stringify(data), { complete: true });
  results.refreshed++;
  console.log(`~ ${name.padEnd(12)} ${key} ${old.elements?.length ?? 0} -> ${data.elements.length} elements, buildings ${before} -> ${after}, in ${secs(t0)}`);
}

async function status(key) {
  const stored = await readStored(key);
  if (!stored) return { state: "missing" };
  if (REFRESH && !DRY) return { state: "refresh", stored };
  if (stored.trusted) return { state: "stored" };
  try {
    const text = (stored.gzip ? gunzipSync(stored.bytes) : stored.bytes).toString("utf8");
    const data = JSON.parse(text);
    return isCompleteCity(data) ? { state: "legacy", text } : { state: "missing" };
  } catch {
    return { state: "missing" };
  }
}

async function fetchCell(key) {
  const { lat, lon } = parseCityKey(key);
  // Two outer attempts; each gets the full budget with mirror retry rounds inside.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const data = await fetchOverpassCell(lat, lon, {
        timeoutMs: TIMEOUT_S * 1000,
        rounds: 8,
        backoffMs: 8000,
      });
      if (isCompleteCity(data)) return data;
      console.log(`  ${key}: partial result (${data.elements?.length ?? 0} elements), retrying`);
    } catch (error) {
      console.log(`  ${key}: attempt ${attempt} failed: ${error?.message || error}`);
    }
    await sleep(15000);
  }
  return null;
}

const results = { stored: 0, upgraded: 0, fetched: 0, refreshed: 0, failed: [] };

async function seed(key, name) {
  const t0 = Date.now();
  const s = await status(key);
  if (s.state === "refresh") return refreshCell(key, name, s.stored, t0);
  if (s.state === "stored") {
    results.stored++;
    return console.log(`= ${name.padEnd(12)} ${key} stored`);
  }
  if (s.state === "legacy") {
    results.stored++;
    if (UPGRADE && !DRY) {
      await uploadObject(`${key}.json`, s.text, { complete: true });
      results.upgraded++;
      return console.log(`^ ${name.padEnd(12)} ${key} legacy entry re-marked complete`);
    }
    return console.log(`= ${name.padEnd(12)} ${key} stored (legacy)`);
  }
  if (DRY) {
    results.failed.push(key);
    return console.log(`? ${name.padEnd(12)} ${key} missing`);
  }
  const data = await fetchCell(key);
  if (!data) {
    results.failed.push(key);
    return console.log(`✗ ${name.padEnd(12)} ${key} failed after ${secs(t0)}`);
  }
  await uploadObject(`${key}.json`, JSON.stringify(data), { complete: true });
  results.fetched++;
  console.log(`✓ ${name.padEnd(12)} ${key} ${data.elements.length} elements in ${secs(t0)}`);
}

console.log(`${GROUP}: ${places.length} places, ${cells.size} cells, conc ${CONC}, Overpass budget ${TIMEOUT_S}s/cell\n`);
const queue = [...cells.entries()];
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (queue.length) {
      const [key, name] = queue.shift();
      try {
        await seed(key, name);
      } catch (error) {
        results.failed.push(key);
        console.log(`✗ ${name.padEnd(12)} ${key} ${error?.message || error}`);
      }
    }
  })
);

console.log(
  `\nstored ${results.stored} · fetched ${results.fetched} · refreshed ${results.refreshed} · upgraded ${results.upgraded} · ` +
    `${DRY ? "missing" : "failed"} ${results.failed.length}`
);
if (results.failed.length) {
  console.log(results.failed.join("\n"));
  process.exit(1);
}
