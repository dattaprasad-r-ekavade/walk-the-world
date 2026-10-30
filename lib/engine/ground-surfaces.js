// Ground surfaces from OSM land-use areas (plan B3). Kept free of three.js so
// the builder worker and tests can classify tags without a renderer.

/**
 * Per-kind look. `texture` picks a shared tiling map (world-space UVs, metres
 * divided by `repeat`); kinds without one stay flat-coloured. `lift` raises
 * the surface above terrain so overlapping areas layer predictably: pitches
 * and water over parks, parks over farmland.
 */
export const GROUND_SURFACE_STYLE = Object.freeze({
  water: { color: 0x4b9fd1, lift: 0.06, roughness: 0.15, metalness: 0.05 },
  waterArea: { color: 0x6fa8d8, lift: 0.06, roughness: 0.15, metalness: 0.05 },
  pool: { color: 0x39a0e0, lift: 0.06, roughness: 0.15, metalness: 0.05 },
  sand: { color: 0xe6d5a3, lift: 0.04, roughness: 0.95 },
  farmland: { color: 0xd3c89e, lift: 0.03, roughness: 0.9 },
  pitch: { color: 0x4f9e5d, lift: 0.06, roughness: 0.85, texture: "grass", repeat: 4 },
  playground: { color: 0xd9b98a, lift: 0.05, roughness: 0.9 },
  track: { color: 0xb5543f, lift: 0.06, roughness: 0.85 },
  golf: { color: 0x7fb56b, lift: 0.03, roughness: 0.85, texture: "grass", repeat: 6 },
  parking: { color: 0x8a9098, lift: 0.05, roughness: 0.9, texture: "asphalt", repeat: 4 },
  grass: { color: 0x93bd7f, lift: 0.04, roughness: 0.9, texture: "grass", repeat: 6 },
  paving: { color: 0xffffff, lift: 0.045, roughness: 0.94, texture: "paving", repeat: 2 },
});

/** Kinds whose areas also get a few trees along their outline. */
export const TREED_GROUND_KINDS = new Set(["grass"]);

/**
 * Classify an OSM way or relation into a ground-surface kind, or null.
 * Pedestrian areas and squares are also walkable roads; callers keep their
 * road handling and add the surface on top (see `alsoRoad`).
 * @returns {{ kind: string, alsoRoad?: boolean, seaLevel?: boolean } | null}
 */
export function groundSurfaceKind(tags) {
  if (!tags) return null;
  // Buildings (multi-storey car parks are often tagged amenity=parking too)
  // and areas below or above ground level are not terrain surfaces.
  if (tags.building || tags["building:part"]) return null;
  if (tags.layer && Number.parseFloat(tags.layer) !== 0) return null;
  if (/^(underground|multi-storey|rooftop)$/.test(tags.parking || "")) return null;
  if (/^(underground|rooftop|roof)$/.test(tags.location || "")) return null;
  const { natural, waterway, landuse = "", leisure, amenity, highway, place } = tags;
  if (natural === "water" || waterway === "riverbank") {
    return { kind: "water", seaLevel: tags["wtw:sea_level"] === "0" };
  }
  if (natural === "beach" || natural === "sand") return { kind: "sand" };
  if (/farmland|orchard|vineyard/.test(landuse)) return { kind: "farmland" };
  if (leisure === "pitch") return { kind: "pitch" };
  if (leisure === "swimming_pool") return { kind: "pool" };
  if (leisure === "playground") return { kind: "playground" };
  if (leisure === "track") return { kind: "track" };
  if (leisure === "golf_course") return { kind: "golf" };
  if (amenity === "parking") return { kind: "parking" };
  if (leisure === "park" || leisure === "garden" || /grass|meadow|forest/.test(landuse)) return { kind: "grass" };
  if ((highway === "pedestrian" && tags.area === "yes") || place === "square") {
    return { kind: "paving", alsoRoad: !!highway };
  }
  return null;
}

/**
 * Planar world-space UVs for a flat surface: one texture repeat every
 * `repeat` metres, so neighbouring areas and cells tile seamlessly.
 * @param {ArrayLike<number>} positions xyz triples
 */
export function worldPlanarUVs(positions, repeat = 1) {
  const count = Math.floor(positions.length / 3);
  const uv = new Float32Array(count * 2);
  const s = 1 / Math.max(1e-6, repeat);
  for (let i = 0; i < count; i++) {
    uv[i * 2] = positions[i * 3] * s;
    uv[i * 2 + 1] = -positions[i * 3 + 2] * s;
  }
  return uv;
}

const SURFACE_MAX_TRIANGLES = 3000;

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToRing(x, z, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz)));
  }
  return best;
}

/**
 * Mesh a land-use ring that follows the terrain instead of sitting flat at
 * one height. Edges are split and interior points added on a grid about
 * `spacing` metres apart (wider for very large areas, to stay under
 * SURFACE_MAX_TRIANGLES), then every vertex is placed `lift` metres above
 * `heightAt(x, z)`. `heightAt` returns null where no terrain is loaded;
 * triangles touching such a vertex are left out rather than guessed, since a
 * guessed height floats or buries the edge on slopes. Null if nothing is left.
 *
 * `triangulate(contour, steinerPoints)` returns triangles as index triples
 * into contour followed by steiner points (THREE.ShapeUtils.triangulateShape
 * with one single-point hole per steiner point does this).
 *
 * @param {{x:number,z:number}[]} ring
 * @returns {{ positions: Float32Array, index: Uint32Array } | null}
 */
export function buildDrapedSurface(ring, { heightAt, lift = 0, spacing = 10, triangulate }) {
  const pts = ring.slice();
  if (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].z === pts[pts.length - 1].z) pts.pop();
  if (pts.length < 3) return null;
  let area2 = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    area2 += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    minX = Math.min(minX, pts[i].x); maxX = Math.max(maxX, pts[i].x);
    minZ = Math.min(minZ, pts[i].z); maxZ = Math.max(maxZ, pts[i].z);
  }
  const area = Math.abs(area2) / 2;
  if (!(area > 0.01)) return null;
  const step = Math.max(spacing, Math.sqrt((2 * area) / SURFACE_MAX_TRIANGLES));

  const contour = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) contour.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  const steiner = [];
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      if (pointInRing(x, z, pts) && distanceToRing(x, z, pts) > step * 0.35) steiner.push({ x, z });
    }
  }

  const all = contour.concat(steiner);
  const heights = all.map((p) => heightAt(p.x, p.z));
  const known = (i) => Number.isFinite(heights[i]);
  const faces = (triangulate(contour, steiner) || []).filter(([a, b, c]) => known(a) && known(b) && known(c));
  if (!faces.length) return null;
  // Keep only vertices that a remaining triangle uses.
  const remap = new Int32Array(all.length).fill(-1);
  const used = [];
  const slot = (i) => {
    if (remap[i] < 0) { remap[i] = used.length; used.push(i); }
    return remap[i];
  };
  const index = new Uint32Array(faces.length * 3);
  faces.forEach(([a, b, c], i) => {
    // Wind every triangle to face up (+Y) for front-face rendering.
    const up = (all[b].z - all[a].z) * (all[c].x - all[a].x) - (all[b].x - all[a].x) * (all[c].z - all[a].z);
    index[i * 3] = slot(a);
    index[i * 3 + 1] = slot(up >= 0 ? b : c);
    index[i * 3 + 2] = slot(up >= 0 ? c : b);
  });
  const positions = new Float32Array(used.length * 3);
  used.forEach((src, i) => {
    positions[i * 3] = all[src].x;
    positions[i * 3 + 1] = heights[src] + lift;
    positions[i * 3 + 2] = all[src].z;
  });
  return { positions, index };
}
