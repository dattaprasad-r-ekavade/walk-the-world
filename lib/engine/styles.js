// Shared palettes: building tint by OSM type, road color+width by class.
export const BUILDING_COLORS = {
  apartments: 0xe8d8c3, house: 0xe3d3b8, residential: 0xe8d8c3,
  office: 0xb8c9dd, commercial: 0xc9bede, industrial: 0xcfc8b8,
  retail: 0xdec3c3, church: 0xd8cbb3, cathedral: 0xd8cbb3,
};

export const ROAD_STYLE = {
  // realistic asphalt greys — distinct from terrain without looking like tar
  motorway: [0x4a4f57, 18], trunk: [0x4a4f57, 16], primary: [0x545a63, 13],
  secondary: [0x5d636c, 11], tertiary: [0x646a73, 9], residential: [0x6d737c, 7],
  unclassified: [0x6d737c, 6], service: [0x7a8088, 4], living_street: [0x7a8088, 6],
  pedestrian: [0x9a9484, 5], footway: [0xa89a72, 2.5], path: [0xa89a72, 2],
  cycleway: [0x5f7d9c, 2.5], track: [0x8a7a58, 3],
};

const MAIN_ROAD_CLASSES = /^(motorway|trunk|primary|secondary|tertiary)$/;

/** Resolve a road's paved width from explicit OSM metadata before class defaults. */
export function roadWidthMeters(tags, fallback) {
  const rawWidth = String(tags?.width ?? "").trim().toLowerCase();
  const widthMatch = rawWidth.match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot|')?$/);
  if (widthMatch) {
    const parsed = Number(widthMatch[1]);
    const metres = ["ft", "feet", "foot", "'"].includes(widthMatch[2]) ? parsed * 0.3048 : parsed;
    if (Number.isFinite(metres) && metres >= 1.5 && metres <= 36) return metres;
  }

  const laneMatch = String(tags?.lanes ?? "").trim().match(/^(\d+(?:\.\d+)?)$/);
  const lanes = laneMatch ? Number(laneMatch[1]) : NaN;
  if (!Number.isFinite(lanes) || lanes < 1 || lanes > 10) return fallback;
  const mainRoad = MAIN_ROAD_CLASSES.test(String(tags?.highway || ""));
  return Math.min(32, lanes * (mainRoad ? 3.2 : 3) + (mainRoad ? 0.5 : 0.4));
}

/** Named CSS / OSM colour keywords → hex. */
const NAMED_COLORS = {
  black: 0x1a1a1a, white: 0xf5f5f5, grey: 0x8a8a8a, gray: 0x8a8a8a,
  red: 0xb8433a, green: 0x4a7a4a, blue: 0x4a6a9a, yellow: 0xc9b24a,
  brown: 0x8a5a3a, orange: 0xc8783a, pink: 0xc98a9a, purple: 0x7a4a8a,
  beige: 0xd8cbb3, cream: 0xe8e0d0, ivory: 0xf0ead8, sand: 0xd4c4a0,
  maroon: 0x6a2a2a, navy: 0x2a3a5a, teal: 0x3a7a7a, olive: 0x6a7a3a,
  silver: 0xb0b4b8, gold: 0xc9a84a, terracotta: 0x9a5340, brick: 0xa85a45,
  concrete: 0x8f8d86, glass: 0x9fb6d9, wood: 0x8a6a45, metal: 0x8a9098,
  stone: 0xa8a498, slate: 0x5a6068, copper: 0xb87333, zinc: 0x9aa0a6,
};

/**
 * Parse OSM colour strings: "#rrggbb", "rgb(r,g,b)", or named keywords.
 * Returns a THREE-style hex number, or null if unparseable.
 */
export function parseOsmColor(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (NAMED_COLORS[s] != null) return NAMED_COLORS[s];
  if (s[0] === '#' && (s.length === 4 || s.length === 7)) {
    const hex = s.length === 4
      ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
      : s;
    const n = parseInt(hex.slice(1), 16);
    return Number.isFinite(n) ? n : null;
  }
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const r = Math.min(255, +rgb[1]);
    const g = Math.min(255, +rgb[2]);
    const b = Math.min(255, +rgb[3]);
    return (r << 16) | (g << 8) | b;
  }
  // bare hex without #
  if (/^[0-9a-f]{6}$/.test(s)) {
    const n = parseInt(s, 16);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Quantize a hex colour so similar shades share one draw-call bucket. */
export function quantizeColor(hex, step = 24) {
  if (hex == null) return hex;
  const r = Math.min(255, Math.round(((hex >> 16) & 255) / step) * step);
  const g = Math.min(255, Math.round(((hex >> 8) & 255) / step) * step);
  const b = Math.min(255, Math.round((hex & 255) / step) * step);
  return (r << 16) | (g << 8) | b;
}

const MATERIAL_TINT = {
  brick: 0xa85a45, plaster: 0xe3ddd2, concrete: 0x8f8d86, wood: 0x8a6a45,
  glass: 0x9fb6d9, metal: 0x8a9098, steel: 0x8a9098, stone: 0xa8a498,
  sandstone: 0xc4a882, marble: 0xe8e4dc, timber: 0x8a6a45,
};

const BUILDING_MATERIAL_FAMILIES = {
  plaster: ["plaster", "stucco", "render", "lime_plaster"],
  brick: ["brick", "brickwork", "clay", "clay_brick", "fired_clay", "red_brick", "terracotta"],
  stone: ["stone", "natural_stone", "sandstone", "limestone", "marble", "granite", "slate"],
  concrete: ["concrete", "reinforced_concrete", "precast_concrete", "concrete_block", "cement_block", "cement", "cinder_block"],
  metal: ["metal", "steel", "iron", "aluminium", "aluminum", "copper", "zinc", "corrugated_metal", "corrugated_iron"],
  glass: ["glass", "glass_wall", "curtain_wall", "glazing"],
  wood: ["wood", "timber", "timber_framing", "log", "wood_panel", "plywood"],
};
const BUILDING_MATERIAL_ALIAS = new Map(
  Object.entries(BUILDING_MATERIAL_FAMILIES).flatMap(([family, aliases]) =>
    aliases.map((alias) => [alias, family])
  )
);

function materialTokens(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .split(/[;,/|]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Fold OSM building:material strings into stable material/cache families. */
export function normalizeBuildingMaterial(raw) {
  const tokens = materialTokens(raw);
  if (!tokens.length) return "";
  for (const token of tokens) {
    const family = BUILDING_MATERIAL_ALIAS.get(token);
    if (family) return family;
  }
  return "other";
}

function materialTint(raw) {
  for (const token of materialTokens(raw)) {
    if (MATERIAL_TINT[token] != null) return MATERIAL_TINT[token];
  }
  const family = normalizeBuildingMaterial(raw);
  return MATERIAL_TINT[family] ?? null;
}

/** Wall colour from OSM appearance tags, falling back to type/height palette. */
export function buildingWallColor(tags, height) {
  const tagged =
    parseOsmColor(tags?.['building:colour']) ??
    parseOsmColor(tags?.['building:color']) ??
    parseOsmColor(tags?.colour);
  if (tagged != null) return quantizeColor(tagged);
  const matColor = materialTint(tags?.['building:material']);
  if (matColor != null) return quantizeColor(matColor);
  const byType = BUILDING_COLORS[tags?.building];
  if (byType != null) return byType;
  const h = height || 8;
  return h > 60 ? 0x9fb6d9 : h > 25 ? 0xd4cfc4 : 0xe3ddd2;
}

/** Flat roof / cap colour from roof:colour or building material. */
export function buildingRoofColor(tags) {
  const tagged = parseOsmColor(tags?.['roof:colour']) ?? parseOsmColor(tags?.['roof:color']);
  if (tagged != null) return quantizeColor(tagged);
  const matColor = materialTint(tags?.['roof:material']);
  if (matColor != null) return quantizeColor(matColor);
  return 0x8f8d86; // default concrete
}

/** Terracotta-ish pitched-roof colour (hipped/gabled). */
export function pitchedRoofColor(tags) {
  const tagged = parseOsmColor(tags?.['roof:colour']) ?? parseOsmColor(tags?.['roof:color']);
  if (tagged != null) return quantizeColor(tagged);
  return 0x9a5340;
}

/** Resolve OSM roof tags to one of the small runtime roof templates. */
export function roofShape(tags, area, height) {
  const shape = String(tags?.['roof:shape'] || '').toLowerCase();
  if (shape) {
    if (/^flat$/.test(shape)) return null;
    if (/^(skillion|shed)$/.test(shape)) return 'skillion';
    if (/^(dome|onion|round)$/.test(shape)) return 'dome';
    if (/^(gabled|gambrel)$/.test(shape)) return 'gabled';
    if (/^(hipped|half-hipped|mansard)$/.test(shape)) return 'hipped';
    if (/^pyramidal$/.test(shape)) return 'pyramidal';
    return null;
  }
  return /^(house|detached|bungalow|hut|residential)$/.test(tags?.building) && area < 260 && height < 12
    ? 'gabled'
    : null;
}

/** Whether a roof template should be built for this building. */
export function wantsPitchedRoof(tags, area, height) {
  return roofShape(tags, area, height) != null;
}
