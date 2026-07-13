const VERSION = 1;

const DETAIL_TAGS = [
  "building:levels", "building:material", "building:colour", "building:color",
  "height", "min_height", "roof:shape", "roof:height", "roof:material",
  "roof:colour", "roof:color", "surface", "lanes", "width", "maxspeed",
  "sidewalk", "cycleway", "lit", "bridge", "tunnel", "layer",
];

const LANDMARK_TAGS = [
  "name", "name:en", "wikidata", "wikipedia", "historic", "tourism",
  "amenity", "shop", "man_made", "natural",
];

function pick(tags, keys) {
  const out = {};
  for (const key of keys) if (tags?.[key] !== undefined) out[key] = String(tags[key]);
  return out;
}

function syntheticElement(feature, index) {
  if (!feature || !feature.kind) return null;
  const seed = JSON.stringify([feature.kind, feature.source, feature.point, feature.geometry?.[0], index]);
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const id = -1_000_000_000 - (hash >>> 0);
  const props = feature.properties || {};
  const tagByKind = {
    ocean: { natural: "water", water: "sea", "wtw:sea_level": "0" },
    water: { natural: "water" },
    beach: { natural: "beach" },
    forest: { landuse: "forest" },
    grass: { landuse: "grass" },
    meadow: { landuse: "meadow" },
    building: { building: props.building || "yes" },
  };
  const tags = { ...(tagByKind[feature.kind] || {}), ...(props.tags || {}) };
  if (feature.source) tags["wtw:source"] = String(feature.source);

  if (feature.kind === "place" && Array.isArray(feature.point)) {
    const [lon, lat] = feature.point;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      type: "node", id, lat, lon,
      tags: { amenity: props.category || "attraction", name: props.name || "Place", ...tags },
    };
  }

  const ring = feature.geometry;
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const geometry = ring
    .map(([lon, lat]) => ({ lat: Number(lat), lon: Number(lon) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (geometry.length < 3) return null;
  return { type: "way", id, geometry, tags };
}

// OSM coastlines are directed with land on the left and sea on the right.
// Turn a line into a narrow sea-side polygon so coastal cells still look blue
// when the raster basemap is missing. This is a fallback, not a global ocean copy.
function coastlineStrip(el, widthM = 1400) {
  const pts = el?.geometry;
  if (!Array.isArray(pts) || pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const lat = (first.lat + last.lat) / 2;
  const mx = Math.max(20_000, 111_320 * Math.cos((lat * Math.PI) / 180));
  const dx = (last.lon - first.lon) * mx;
  const dy = (last.lat - first.lat) * 111_320;
  const len = Math.hypot(dx, dy);
  if (len < 2) return null;
  const east = (dy / len) * widthM;
  const north = (-dx / len) * widthM;
  const shifted = pts.map((p) => [p.lon + east / mx, p.lat + north / 111_320]);
  return {
    kind: "ocean",
    source: "openstreetmap-coastline",
    geometry: [
      ...pts.map((p) => [p.lon, p.lat]),
      ...shifted.reverse(),
      [pts[0].lon, pts[0].lat],
    ],
  };
}

/** Build a compact, deterministic enrichment block from an OSM city cell. */
export function deriveCellEnrichment(cityData, extra = {}) {
  const elements = cityData?.elements || [];
  const patches = {};
  const landmarks = [];
  const counts = { buildings: 0, roads: 0, pois: 0, water: 0, coastline: 0 };
  const coastlineFeatures = [];

  for (const el of elements) {
    const tags = el.tags || {};
    if (tags.building) counts.buildings++;
    if (tags.highway && el.type === "way") counts.roads++;
    if (tags.shop || tags.amenity || tags.tourism || tags.historic) counts.pois++;
    if (tags.natural === "water" || tags.waterway) counts.water++;
    if (tags.natural === "coastline") {
      counts.coastline++;
      if (coastlineFeatures.length < 12) {
        const feature = coastlineStrip(el);
        if (feature) coastlineFeatures.push(feature);
      }
    }

    const detail = pick(tags, DETAIL_TAGS);
    if (Object.keys(detail).length) patches[`${el.type}/${el.id}`] = detail;
    if (
      landmarks.length < 40 &&
      (tags.wikidata || tags.wikipedia || tags.tourism === "attraction" || tags.historic)
    ) {
      landmarks.push({
        ref: `${el.type}/${el.id}`,
        ...(el.type === "node" ? { point: [el.lon, el.lat] } : {}),
        tags: pick(tags, LANDMARK_TAGS),
      });
    }
  }

  const score = Math.min(1, (counts.buildings / 350 + counts.roads / 100 + counts.pois / 90) / 3);
  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    sources: ["openstreetmap", ...(extra.sources || [])].filter((v, i, a) => a.indexOf(v) === i),
    counts,
    density: { urban: Math.round(score * 1000) / 1000, ...(extra.density || {}) },
    patches: { ...patches, ...(extra.patches || {}) },
    landmarks: [...landmarks, ...(extra.landmarks || [])].slice(0, 60),
    features: [
      ...((extra.features || []).some((f) => f.kind === "ocean") ? [] : coastlineFeatures),
      ...(extra.features || []),
    ].slice(0, 500),
  };
}

/** Apply enrichment without mutating the cached object returned by fetch(). */
export function applyCellEnrichment(cityData) {
  if (!cityData?.enrichment || cityData.enrichment.version !== VERSION) return cityData;
  const enrichment = cityData.enrichment;
  const patches = enrichment.patches || {};
  const elements = (cityData.elements || []).map((el) => {
    const patch = patches[`${el.type}/${el.id}`];
    return patch ? { ...el, tags: { ...(el.tags || {}), ...patch } } : el;
  });
  const existing = new Set(elements.map((el) => `${el.type}/${el.id}`));
  for (let i = 0; i < (enrichment.features || []).length; i++) {
    const el = syntheticElement(enrichment.features[i], i);
    if (el && !existing.has(`${el.type}/${el.id}`)) elements.push(el);
  }
  return { ...cityData, elements };
}

export const CELL_ENRICHMENT_VERSION = VERSION;
