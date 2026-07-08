// Seed the R2 city cache so every fast-travel spot (and its neighbors) is a
// warm hit instead of a 20-60s cold Overpass fetch.
//
//   node scripts/warm-cities.mjs                       # against localhost:3000
//   node scripts/warm-cities.mjs https://your.app      # against a deployment
//
// Safe to re-run: warm cells return in ~1s and cost nothing. Cold cells hit
// Overpass once, then live in R2 forever (whatever renders once is cached).
import { PLACES } from "../lib/geo.js";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const CACHE_VERSION = 5; // keep in sync with lib/engine/cityData.js
const D = 0.0055; // neighbor cell offset used by the engine's prefetch

const key = (lat, lon) => `wtw_city${CACHE_VERSION}_${lat.toFixed(3)}_${lon.toFixed(3)}`;

const cells = new Map();
for (const p of PLACES) {
  for (const [la, lo] of [
    [p.lat, p.lon],
    [p.lat + D, p.lon],
    [p.lat - D, p.lon],
    [p.lat, p.lon + D],
    [p.lat, p.lon - D],
  ]) {
    cells.set(key(la, lo), { la, lo, name: p.name });
  }
}

console.log(`Warming ${cells.size} cells (${PLACES.length} places + neighbors) against ${BASE}\n`);

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
