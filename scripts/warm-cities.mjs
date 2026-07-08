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
//   --budget=30     stop starting new fetches after N seconds (resumable runs)
//   --state=file    JSON checkpoint of finished cells, skipped instantly on re-run
//   --conc=2        parallel fetches
const BUDGET = Number((argsAll.find((a) => a.startsWith("--budget=")) || "").slice(9)) || 0;
const STATE_FILE = (argsAll.find((a) => a.startsWith("--state=")) || "").slice(8);
const CONC = Number((argsAll.find((a) => a.startsWith("--conc=")) || "").slice(7)) || 2;
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

import { readFileSync, writeFileSync } from "fs";
const done = new Set();
if (STATE_FILE) {
  try { for (const k of JSON.parse(readFileSync(STATE_FILE, "utf8"))) done.add(k); } catch { /* fresh */ }
}
const entries = [...cells.entries()].filter(([k]) => !done.has(k));
console.log(`Warming ${entries.length}/${cells.size} cells (${done.size} already done) against ${BASE}\n`);

// pre-flight: don't start until the server actually answers (a startup race
// otherwise burns the whole list on instant connection-refused errors)
let up = false;
for (let tries = 0; tries < 20 && !up; tries++) {
  try { await fetch(`${BASE}/api/assets`, { signal: AbortSignal.timeout(3000) }); up = true; }
  catch { await new Promise((r) => setTimeout(r, 1000)); }
}
if (!up) { console.log(`server at ${BASE} not reachable — aborting (state kept)`); process.exit(1); }

let ok = 0, fail = 0, i = 0, connFails = 0;
const t0all = Date.now();
const CONCURRENCY = CONC; // stay polite to Overpass on cold cells

const saveState = () => {
  if (STATE_FILE) writeFileSync(STATE_FILE, JSON.stringify([...done]));
};
async function worker() {
  while (i < entries.length) {
    if (BUDGET && (Date.now() - t0all) / 1000 > BUDGET) return;
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
        done.add(k);
        saveState();
        console.log(`✓ ${name.padEnd(16)} ${k}  ${d.elements?.length ?? 0} elements  ${secs}s`);
      } else {
        fail++;
        console.log(`✗ ${name.padEnd(16)} ${k}  HTTP ${res.status}  ${secs}s`);
      }
    } catch (e) {
      fail++;
      console.log(`✗ ${name.padEnd(16)} ${k}  ${e?.message}`);
      if (String(e?.message).includes("fetch failed") && ++connFails > 5) {
        console.log("too many connection failures — server gone, stopping (state kept)");
        return;
      }
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
saveState();
console.log(`\nThis run: ${ok} warmed, ${fail} failed · total done ${done.size}/${cells.size}`);
