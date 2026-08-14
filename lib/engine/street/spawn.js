// Spawn framing — where the player stands on the first frame, and which way
// they face.
//
// The old rule was "nearest walkable road vertex to the cell origin, face along
// the segment". Correct, but blind in two ways:
//
//   1. The nearest vertex is often a footpath at the edge of a park rather than
//      a street with frontage.
//   2. It faced along `next - current`, i.e. the direction the OSM way happened
//      to be *digitised*. Way direction in OSM is arbitrary, so the opening
//      shot was a coin flip between "down the street" and "out at open ground".
//
// Measured across the 18 fast-travel cities, that produced 5 opening frames
// with literally zero buildings in the view cone (Pune, Seoul, Istanbul, SF,
// Sydney). It is the worst first impression the app can make and no amount of
// material or lighting work fixes it.
//
// So: score candidate poses by what the camera would actually SEE. Ray-march
// the view cone against building footprints and prefer a pose with buildings in
// frame AND a clear view down the street — the street-canyon shot the whole
// genre is built on.
//
// Rings are the engine's native `[[x, z], ...]` pairs. No THREE import, so this
// runs headless in scripts/diag-spawn.mjs and is testable without a GPU.

const DEG = Math.PI / 180;

// Streets worth standing on, vs. streets that merely happen to be closest.
// Motorways have no frontage; alleys and tracks have no view.
const CLASS_BONUS = {
  pedestrian: 1.0, living_street: 0.95, residential: 0.92, tertiary: 0.88,
  secondary: 0.82, unclassified: 0.7, primary: 0.62, footway: 0.55,
  cycleway: 0.45, service: 0.35, path: 0.28, track: 0.15,
  trunk: 0.1, motorway: 0.05,
};

const MAX_MOVE = 120;      // never relocate the player further than this
const FOV_HALF = 33 * DEG; // ~66° horizontal, matches the camera
const RAYS = 21;
const MARCH_MAX = 90;
const MARCH_STEP = 2.5;
const MAX_CANDIDATES = 160;

/** Even-odd point-in-polygon over `[[x, z], ...]`. */
export function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (
      ring[i][1] > z !== ring[j][1] > z &&
      x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]
    )
      inside = !inside;
  }
  return inside;
}

/**
 * Grid-indexed hit test over building rings. The engine passes its existing
 * `insideBuilding` instead — this exists for headless callers that have rings
 * but no collision system.
 */
export function createHitTest(rings, cellSize = 60) {
  const grid = new Map();
  for (const ring of rings || []) {
    if (!ring || ring.length < 3) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [px, pz] of ring) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }
    const fp = { ring, minX, maxX, minZ, maxZ };
    for (let gx = Math.floor(minX / cellSize); gx <= Math.floor(maxX / cellSize); gx++)
      for (let gz = Math.floor(minZ / cellSize); gz <= Math.floor(maxZ / cellSize); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(fp);
      }
  }
  return (x, z) => {
    const list = grid.get(`${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`);
    if (!list) return false;
    for (const fp of list) {
      if (x < fp.minX || x > fp.maxX || z < fp.minZ || z > fp.maxZ) continue;
      if (inRing(x, z, fp.ring)) return true;
    }
    return false;
  };
}

/**
 * How good does this pose look? Ray-march the view cone against footprints.
 *
 *   coverage — fraction of rays finding a building inside 90 m. Buildings in
 *              frame is what separates "a city" from "a field".
 *   openness — the central rays must stay clear for ~30 m, else the player is
 *              staring at a wall instead of down a street.
 *
 * score = coverage × openness (× a penalty for being jammed against a wall).
 *
 * @param {{x:number,z:number,heading:number}} pose
 * @param {(x:number,z:number)=>boolean} hit
 */
export function viewScore(pose, hit) {
  const { x, z, heading } = pose;
  const mid = (RAYS - 1) / 2;
  let hits = 0;
  let centreClear = 0;
  for (let r = 0; r < RAYS; r++) {
    const t = (r / (RAYS - 1)) * 2 - 1; // -1..1 across the cone
    const a = heading + t * FOV_HALF;
    // engine convention: heading 0 faces -Z, forward = (sin h, -cos h)
    const dx = Math.sin(a), dz = -Math.cos(a);
    let hitAt = Infinity;
    for (let d = MARCH_STEP; d <= MARCH_MAX; d += MARCH_STEP) {
      if (hit(x + dx * d, z + dz * d)) { hitAt = d; break; }
    }
    if (hitAt < Infinity) hits++;
    // Openness = the BEST sightline among the innermost rays, not the worst.
    // Standing on a pavement, a ray a few degrees off-axis clips the facade
    // beside you within metres — that is what a pavement looks like, not a
    // blocked view. Taking the min here scored real street canyons at 0.5 and
    // pushed the spawn back into the middle of the carriageway.
    if (Math.abs(r - mid) <= 1) centreClear = Math.max(centreClear, Math.min(hitAt, MARCH_MAX));
  }
  const coverage = hits / RAYS;
  const openness = Math.max(0, Math.min(1, centreClear / 30));
  return {
    score: coverage * openness,
    coverage,
    openness,
    centreClear: centreClear >= MARCH_MAX ? null : Math.round(centreClear),
  };
}

/**
 * Choose the opening shot.
 *
 * @param {object} geo
 * @param {Array<{x,z,nx,nz,cls?,width?}>} geo.roadPoints  walkable road vertices
 * @param {(x,z)=>boolean} [geo.hit]      building hit test (engine: insideBuilding)
 * @param {Array<Array<[number,number]>>} [geo.buildings]  rings, if no `hit` given
 * @param {{maxMove?:number, originX?:number, originZ?:number}} [opts]
 * @returns {{x,z,heading,cls,score,coverage,openness,movedM}|null}
 */
export function pickSpawn(geo, opts = {}) {
  const maxMove = opts.maxMove ?? MAX_MOVE;
  const ox = opts.originX ?? 0, oz = opts.originZ ?? 0;
  const pts = geo?.roadPoints || [];
  if (!pts.length) return null;
  const hit = geo.hit || createHitTest(geo.buildings || []);

  // Candidates inside the move budget, thinned so a dense cell doesn't cost
  // thousands of ray-marches. Nearest-first so ties favour the requested point.
  const near = [];
  for (const p of pts) {
    const d = Math.hypot(p.x - ox, p.z - oz);
    if (d <= maxMove) near.push({ p, d });
  }
  if (!near.length) return null;
  near.sort((a, b) => a.d - b.d);
  const stride = Math.max(1, Math.floor(near.length / MAX_CANDIDATES));
  const cands = [];
  for (let i = 0; i < near.length && cands.length < MAX_CANDIDATES; i += stride) cands.push(near[i]);

  let best = null;
  for (const { p, d } of cands) {
    const vx = p.nx - p.x, vz = p.nz - p.z;
    const len = Math.hypot(vx, vz);
    if (!len) continue;
    const ux = vx / len, uz = vz / len;
    // Stand on the pavement, not the centreline: offset perpendicular and take
    // whichever side is clear, falling back to the centreline.
    const off = Math.min(6, (p.width || 6) / 2 + 1.4);
    let pos = null;
    for (const s of [
      { x: p.x - uz * off, z: p.z + ux * off },
      { x: p.x + uz * off, z: p.z - ux * off },
      { x: p.x, z: p.z },
    ]) {
      if (!hit(s.x, s.z)) { pos = s; break; }
    }
    if (!pos) continue;

    // Both ways down the street — the view decides, not the OSM digitising order.
    for (const sign of [1, -1]) {
      const heading = Math.atan2(ux * sign, -uz * sign);
      const v = viewScore({ x: pos.x, z: pos.z, heading }, hit);
      const cls = CLASS_BONUS[p.cls] ?? 0.5;
      // The user asked for a specific point; drifting a block away to gain a
      // few points of framing is a bad trade. Superlinear penalty makes short
      // moves nearly free and long ones expensive, and the class bonus is
      // weighted only enough to break ties between equally-framed poses.
      const distPen = Math.pow(d / maxMove, 1.6) * 0.5;
      const total = v.score * 0.78 + cls * 0.14 - distPen;
      if (!best || total > best.total)
        best = {
          x: pos.x, z: pos.z, heading, cls: p.cls, total,
          score: v.score, coverage: v.coverage, openness: v.openness,
          centreClear: v.centreClear, movedM: Math.round(d),
        };
    }
  }
  return best;
}

/**
 * Best heading from a FIXED position — used when resuming a saved position,
 * where moving the player is not allowed.
 *
 * Resume has no URL coordinates, so the saved point becomes the next cell
 * origin. If framing were allowed to relocate the player there, every session
 * would nudge them up to MAX_MOVE and the saved position would wander. Heading
 * carries no such risk: it is never persisted, so re-choosing it each load is
 * free and still fixes the "facing a blank wall on load" case.
 *
 * @returns {{heading:number, score:number, coverage:number, openness:number}}
 */
export function pickHeading(x, z, hit, steps = 24) {
  let best = null;
  for (let i = 0; i < steps; i++) {
    const heading = (i / steps) * Math.PI * 2;
    const v = viewScore({ x, z, heading }, hit);
    if (!best || v.score > best.score) best = { heading, ...v };
  }
  return best;
}

/**
 * Parse raw OSM elements into just what spawn scoring needs. Mirrors
 * city-builder-core's filters so the headless diagnostic and the engine agree
 * on what counts as a walkable road. Headless callers only.
 */
export function extractSpawnGeometry(elements, toLocal, ROAD_STYLE) {
  const buildings = [];
  const roadPoints = [];
  for (const way of elements || []) {
    if (!way?.geometry || way.geometry.length < 2) continue;
    if (way.tags?.building) {
      if (way.geometry.length < 3) continue;
      buildings.push(way.geometry.map((g) => { const p = toLocal(g.lat, g.lon); return [p.x, p.z]; }));
    } else if (way.tags?.highway && ROAD_STYLE[way.tags.highway]) {
      const cls = way.tags.highway;
      if (way.tags.bridge) continue;
      if (cls === "motorway" || cls === "trunk") continue; // not walkable
      const width = ROAD_STYLE[cls][1];
      const pts = way.geometry.map((g) => { const p = toLocal(g.lat, g.lon); return { x: p.x, z: p.z }; });
      for (let i = 0; i < pts.length; i++) {
        const nb = pts[i + 1] || pts[i - 1] || pts[i];
        roadPoints.push({ x: pts[i].x, z: pts[i].z, nx: nb.x, nz: nb.z, cls, width });
      }
    }
  }
  return { buildings, roadPoints };
}
