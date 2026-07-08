// Seed the R2 city cache so every fast-travel spot (and its neighbors) is a
// warm hit instead of a 20-60s cold Overpass fetch.
//
//   node scripts/warm-cities.mjs                       # against localhost:3000
//   node scripts/warm-cities.mjs https://your.app      # against a deployment
//
// Safe to re-run: warm cells return in ~1s and cost nothing. Cold cells hit
// Overpass once, then live in R2 forever (whatever renders once is cached).
import { PLACES } from "../lib/geo.js";
import { SEED_GROUPS } from "../lib/seedPlaces.js";

//   node scripts/warm-cities.mjs [base-url] [--list] [--group="Goa"]
//   --list          print the plan (groups, places, cells, estimates), no fetching
//   --group="name"  seed one group only (matches SEED_GROUPS keys or "Fast travel")
const argsAll = process.argv.slice(2);
const BASE = (argsAll.find((a) => !a.startsWith("--")) || "http://localhost:3000").replace(/\/$/, "");
const LIST_ONLY = argsAll.includes("--list");
const GROUP = (argsAll.find((a) => a.startsWith("--group=")) || "").slice(8).replace(/"/g, "");
const CACHE_VERSION = 5; // keep in sync with lib/engine/cityData.js
const D = 0.0055; // neighbor cell offset used by the engine's prefetch

const key = (lat, lon) => `wtw_city${CACHE_VERSION}_${lat.toFixed(3)}_${lon.toFixed(3)}`;

const GROUPS = { "Fast travel": PLACES, ...SEED_GROUPS };
const cells = new Map();
let placeCount = 0;
for (const [gname, list] of Object.entries(GROUPS)) {
  if (GROUP && gname !== GROUP) continue;
  for (const p of list) {
    placeCount++;
    for (const [la, lo] of [
      [p.lat, p.lon],
      [p.lat + D, p.lon],
      [p.lat - D, p.lon],
      [p.lat, p.lon + D],
      [p.lat, p.lon - D],
    ]) {
      if (!cells.has(key(la, lo))) cells.set(key(la, lo), { la, lo, name: p.name, group: gname });
    }
  }
}

if (LIST_ONLY) {
  for (const [gname, list] of Object.entries(GROUPS)) {
    if (GROUP && gname !== GROUP) continue;
    console.log(`\n${gname} (${list.length} places):`);
    for (const p of list) console.log(`  ${p.name.padEnd(22)} ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`);
  }
  console.log(`\nTotal: ${placeCount} places → ${cells.size} unique cells`);
  console.log(`Estimated storage: ~${Math.round(cells.size * 45 / 1024)} MB in R2 (dense-cell avg ~45KB gz)`);
  console.log(`Estimated time (cold, 2 concurrent, ~8s/cell): ~${Math.round(cells.size * 8 / 2 / 60)} min; warm cells re-check in ~1s`);
  process.exit(0);
}

console.log(`Warming ${cells.size} cells (${placeCount} places + neighbors) against ${BASE}\n`);

let ok = 0, fail = 0, i = 0;
const entries = [...cells.entries()];
const CONCURRENCY = 2; // stay polite to Overpass on cold cells

async function worker() {
  while (i < entries.length) {
    const [k, { name }] = entries[i++];
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}/api/city/${k}`, {
        signal: AbortSignal.timeout(110_000),
      });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (res.ok) {
        const d = await res.json();
        ok++;
        console.log(`✓ ${name.padEnd(16)} ${k}  ${d.elements?.length ?? 0} elements  ${secs}s`);
      } else {
        fail++;
        console.log(`✗ ${name.padEnd(16)} ${k}  HTTP ${res.status}  ${secs}s`);
      }
    } catch (e) {
      fail++;
      console.log(`✗ ${name.padEnd(16)} ${k}  ${e?.message}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`\nDone: ${ok} warm, ${fail} failed (re-run to retry failures).`);
