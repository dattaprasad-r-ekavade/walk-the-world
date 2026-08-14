#!/usr/bin/env node
/**
 * Spawn-framing diagnostic. Pulls real cell data and reproduces the engine's
 * projection + spawn rule headlessly (no THREE, no GPU), so we can measure
 * WHAT THE PLAYER SEES on the first frame across many cities in seconds.
 *
 *   node scripts/diag-spawn.mjs                     # default city list
 *   node scripts/diag-spawn.mjs --base=https://...  # pull cells from a deploy
 *   node scripts/diag-spawn.mjs --json=out.json
 *
 * Reports, per city: chosen spawn point, road class, heading, and the
 * "framing score" — how much built geography falls inside the view cone.
 */
import { makeLocalFrame } from "../lib/engine/geo.js";
import { ROAD_STYLE } from "../lib/engine/styles.js";
import { PLACES } from "../lib/geo.js";
import { pickSpawn, viewScore, extractSpawnGeometry, createHitTest } from "../lib/engine/street/spawn.js";
import { writeFileSync } from "fs";

const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith("--base=")) || "--base=https://walk-the-world-delta.vercel.app").slice(7).replace(/\/$/, "");
const JSON_OUT = (args.find((a) => a.startsWith("--json=")) || "").slice(7);
const ONLY = (args.find((a) => a.startsWith("--only=")) || "").slice(7);
const CACHE_VERSION = 6;
const key = (lat, lon) => `wtw_city${CACHE_VERSION}_${lat.toFixed(3)}_${lon.toFixed(3)}`;

const CITIES = (ONLY
  ? PLACES.filter((p) => p.name.toLowerCase().includes(ONLY.toLowerCase()))
  : PLACES
).slice(0, 20);

/** The spawn rule as it shipped: nearest walkable road VERTEX to the origin. */
function legacySpawn(roadPoints) {
  let best = null, bestD = Infinity;
  for (const pt of roadPoints) {
    const d = pt.x * pt.x + pt.z * pt.z;
    if (d < bestD) { bestD = d; best = pt; }
  }
  if (!best) return null;
  const vx = best.nx - best.x, vz = best.nz - best.z;
  return {
    x: best.x, z: best.z,
    heading: vx || vz ? Math.atan2(vx, -vz) : 0,
    cls: best.cls || "?",
  };
}

const rows = [];
for (const p of CITIES) {
  const k = key(p.lat, p.lon);
  let data;
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/city/${k}`, { signal: AbortSignal.timeout(240_000) });
    if (!res.ok) { console.log(`✗ ${p.name.padEnd(16)} HTTP ${res.status}`); continue; }
    data = await res.json();
  } catch (e) {
    console.log(`✗ ${p.name.padEnd(16)} ${e?.message}`);
    continue;
  }
  const fetchMs = Date.now() - t0;
  const { toLocal } = makeLocalFrame(p.lat, p.lon);
  const geo = extractSpawnGeometry(data.elements || [], toLocal, ROAD_STYLE);

  const hit = createHitTest(geo.buildings);
  const before = legacySpawn(geo.roadPoints);
  const after = pickSpawn({ ...geo, hit });
  if (!before || !after) {
    console.log(`· ${p.name.padEnd(16)} no walkable roads in cell (${geo.roadPoints.length} pts)`);
    continue;
  }
  const sBefore = viewScore(before, hit);
  const sAfter = viewScore(after, hit);
  rows.push({
    city: p.name, fetchMs,
    elements: (data.elements || []).length,
    buildings: geo.buildings.length,
    before: { ...before, ...sBefore },
    after: { ...after, ...sAfter },
  });
  const d = (n) => String(Math.round(n)).padStart(3);
  console.log(
    `${p.name.padEnd(16)} bld:${String(geo.buildings.length).padStart(4)}  ` +
    `before ${d(sBefore.score * 100)}% (${before.cls}, ${d(Math.hypot(before.x, before.z))}m)  →  ` +
    `after ${d(sAfter.score * 100)}% (${after.cls}, ${d(Math.hypot(after.x, after.z))}m)`
  );
}

if (rows.length) {
  const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const bAvg = avg((r) => r.before.score), aAvg = avg((r) => r.after.score);
  const worse = rows.filter((r) => r.after.score < r.before.score - 0.01);
  console.log(`\n${rows.length} cities · framing score before ${(bAvg * 100).toFixed(1)}% → after ${(aAvg * 100).toFixed(1)}%`);
  const moves = rows.map((r) => r.after.movedM).sort((a, b) => a - b);
  console.log(`drift from requested point: median ${moves[moves.length >> 1]}m, max ${moves[moves.length - 1]}m, over 60m: ${moves.filter((m) => m > 60).length}/${moves.length}`);
  console.log(`empty frames (<15%): before ${rows.filter((r) => r.before.score < 0.15).length} → after ${rows.filter((r) => r.after.score < 0.15).length}`);
  if (worse.length) console.log(`REGRESSIONS: ${worse.map((r) => r.city).join(", ")}`);
}
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2)); console.log(`\nwrote ${JSON_OUT}`); }
