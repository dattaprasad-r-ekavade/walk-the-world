#!/usr/bin/env node
/**
 * Find cached cells that were stored with no buildings — the partial-Overpass
 * poisoning described in lib/overpassServer.js#looksPartial. R2 is
 * authoritative, so these never heal on their own.
 *
 *   node scripts/scan-partial-cells.mjs                  # fast-travel list
 *   node scripts/scan-partial-cells.mjs --all            # every seeded group
 *   node scripts/scan-partial-cells.mjs --neighbors      # include the ±0.0055 ring
 *   node scripts/scan-partial-cells.mjs --fix --key=SECRET
 *
 * --fix re-fetches each poisoned cell with ?refresh=1 (needs EDITOR_SECRET).
 */
import { PLACES } from "../lib/geo.js";
import { SEED_GROUPS } from "../lib/seedPlaces.js";
import { looksPartial } from "../lib/overpassServer.js";

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith("--base=")) || "--base=https://walk-the-world-delta.vercel.app").slice(7).replace(/\/$/, "");
const ALL = args.includes("--all");
const NEIGHBORS = args.includes("--neighbors");
const FIX = args.includes("--fix");
const KEY = (args.find((a) => a.startsWith("--key=")) || "").slice(6);
const CACHE_VERSION = 6;
const D = 0.0055;
const cellKey = (lat, lon) => `wtw_city${CACHE_VERSION}_${lat.toFixed(3)}_${lon.toFixed(3)}`;

const groups = ALL ? { "Fast travel": PLACES, ...SEED_GROUPS } : { "Fast travel": PLACES };
const cells = new Map();
for (const [gname, list] of Object.entries(groups))
  for (const p of list) {
    const coords = NEIGHBORS
      ? [[p.lat, p.lon], [p.lat + D, p.lon], [p.lat - D, p.lon], [p.lat, p.lon + D], [p.lat, p.lon - D]]
      : [[p.lat, p.lon]];
    for (const [la, lo] of coords)
      if (!cells.has(cellKey(la, lo))) cells.set(cellKey(la, lo), { name: p.name, group: gname });
  }

console.log(`Scanning ${cells.size} cells against ${BASE}\n`);
const bad = [];
let checked = 0, missing = 0;
for (const [k, { name }] of cells) {
  try {
    const res = await fetch(`${BASE}/api/city/${k}`, { signal: AbortSignal.timeout(240_000) });
    if (!res.ok) { missing++; console.log(`  ? ${name.padEnd(18)} ${k} HTTP ${res.status}`); continue; }
    const d = await res.json();
    const chk = looksPartial(d.elements);
    checked++;
    if (chk.partial) {
      bad.push({ key: k, name, ...chk });
      console.log(`  ✗ ${name.padEnd(18)} ${k}  0 buildings / ${chk.highways} roads`);
    }
  } catch (e) {
    missing++;
    console.log(`  ? ${name.padEnd(18)} ${k} ${e?.message}`);
  }
}

console.log(`\n${checked} cells checked · ${bad.length} poisoned · ${missing} unreachable`);
if (bad.length && !FIX) {
  console.log(`\nRe-fetch them with:\n  node scripts/scan-partial-cells.mjs --fix --key=$EDITOR_SECRET`);
}
if (bad.length && FIX) {
  if (!KEY) { console.log("--fix needs --key=<EDITOR_SECRET>"); process.exit(1); }
  console.log(`\nRe-fetching ${bad.length} cells (cold Overpass, ~30-90s each)...`);
  for (const b of bad) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}/api/city/${b.key}?refresh=1`, {
        headers: { "x-editor-key": KEY },
        signal: AbortSignal.timeout(300_000),
      });
      const d = await res.json();
      const chk = looksPartial(d.elements);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${chk.partial ? "✗ still empty" : "✓ fixed"} ${b.name.padEnd(18)} ${chk.buildings} buildings  ${secs}s`);
    } catch (e) {
      console.log(`  ✗ ${b.name.padEnd(18)} ${e?.message}`);
    }
    await new Promise((r) => setTimeout(r, 12_000)); // stay polite to Overpass
  }
}
