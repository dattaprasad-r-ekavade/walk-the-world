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
