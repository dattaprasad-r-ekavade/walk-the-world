// PBR material factory (plan 17.1): MeshStandardMaterial with procedural
// albedo + normal + roughness. Optional CC0 maps at /textures/*.jpg override
// when present (Poly Haven / ambientCG hosted on R2 or public/).
import * as THREE from "three";
import { makeRoadTexture, makeRailTexture } from "@/lib/engine/textures";
import { makeFacadeAtlas, makeLitWindowAtlas } from "@/lib/engine/facade-uv";
import { normalizeBuildingMaterial } from "@/lib/engine/styles";

function makeNormalMap(kind) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  // flat normal base (pointing +Z in tangent space ≈ rgb 128,128,255)
  g.fillStyle = "#8080ff";
  g.fillRect(0, 0, 128, 128);
  if (kind === "brick") {
    for (let y = 0; y < 128; y += 16) {
      for (let x = (Math.floor(y / 16) % 2) * 16; x < 128; x += 32) {
        g.fillStyle = "#7070f0";
        g.fillRect(x, y, 30, 14);
        g.fillStyle = "#9090ff";
        g.fillRect(x + 1, y + 1, 28, 12);
      }
    }
  } else if (kind === "asphalt") {
    for (let i = 0; i < 400; i++) {
      const n = 110 + Math.random() * 40;
      g.fillStyle = `rgb(${n},${n},${200 + Math.random() * 40})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  } else if (kind === "plaster") {
    for (let i = 0; i < 200; i++) {
      const n = 120 + Math.random() * 20;
      g.fillStyle = `rgb(${n},${n},${230})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }
  } else if (kind === "concrete") {
    for (let i = 0; i < 150; i++) {
      g.fillStyle = `rgb(${100 + Math.random() * 40},${100 + Math.random() * 40},240)`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 4, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function makeRoughnessMap(roughBase = 0.7) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const v = Math.round(roughBase * 255);
  g.fillStyle = `rgb(${v},${v},${v})`;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 80; i++) {
    const d = Math.round((Math.random() - 0.5) * 40);
    const n = Math.max(0, Math.min(255, v + d));
    g.fillStyle = `rgb(${n},${n},${n})`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Material instances shared across cells (flagged userData.shared so cell eviction skips them).
const matCache = { building: new Map(), roof: new Map(), road: new Map(), simple: new Map() };
const cache = {
  facade: null,
  lit: null,
  normals: {},
  rough: {},
  road: {},
  rail: null,
};
const roadMaterials = new Set();
let currentRoadWetness = 0;

function applyRoadWetness(material, wetness) {
  material.roughness = 1 - wetness * 0.72; // 1.0 dry -> 0.28 slick
  material.envMapIntensity = 0.55 + wetness * 0.85;
  material.needsUpdate = false; // uniform-only change, no shader recompile
}

function facadeNormalFor(materialKey) {
  const key =
    /brick|stone|sandstone/.test(materialKey || "")
      ? "brick"
      : /concrete|metal|steel/.test(materialKey || "")
        ? "concrete"
        : "plaster";
  if (!cache.normals[key]) cache.normals[key] = makeNormalMap(key);
  return cache.normals[key];
}

/**
 * Building wall PBR material. Keeps emissive night windows.
 * @param {{ color: number, materialKey?: string }} opts
 */
export function getBuildingMaterial({ color, materialKey }) {
  const familyKey = normalizeBuildingMaterial(materialKey);
  const ck = `${color}|${familyKey}`;
  if (matCache.building.has(ck)) return matCache.building.get(ck);
  if (!cache.facade) cache.facade = makeFacadeAtlas();
  if (!cache.lit) cache.lit = makeLitWindowAtlas();
  const normal = facadeNormalFor(familyKey);
  const roughKey = familyKey || "plaster";
  if (!cache.rough[roughKey]) {
    const r = /glass|metal/.test(roughKey) ? 0.25 : /brick|stone/.test(roughKey) ? 0.85 : 0.72;
    cache.rough[roughKey] = makeRoughnessMap(r);
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    map: cache.facade,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: cache.rough[roughKey],
    roughness: 1,
    metalness: /metal|glass/.test(familyKey) ? 0.35 : 0.02,
    vertexColors: true,
    emissive: 0xffffff,
    emissiveMap: cache.lit,
    emissiveIntensity: 0,
    envMapIntensity: 0.55,
  });
  mat.userData.pbr = true;
  mat.userData.shared = true; // cached across cells; see disposeSceneGroup
  matCache.building.set(ck, mat);
  return mat;
}

export function getRoofMaterial(color, pitched = false) {
  const ck = `${color}|${pitched}`;
  if (matCache.roof.has(ck)) return matCache.roof.get(ck);
  if (!cache.normals.concrete) cache.normals.concrete = makeNormalMap("concrete");
  if (!cache.rough.roof) cache.rough.roof = makeRoughnessMap(pitched ? 0.78 : 0.88);
  const mat = new THREE.MeshStandardMaterial({
    color,
    normalMap: cache.normals.concrete,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: cache.rough.roof,
    roughness: 1,
    metalness: 0.05,
    flatShading: pitched,
    envMapIntensity: 0.4,
  });
  mat.userData.shared = true;
  matCache.roof.set(ck, mat);
  return mat;
}

/** Map OSM highway class → asphalt texture variant. */
export function roadMarkKind(highway) {
  const hw = highway || "";
  if (/^(motorway|trunk|primary|secondary|tertiary)$/.test(hw)) return "arterial";
  if (/^(residential|unclassified|living_street)$/.test(hw)) return "residential";
  if (/^(footway|path|pedestrian|track)$/.test(hw)) return "path";
  return "plain";
}

/**
 * @param {number} color — ROAD_STYLE tint
 * @param {boolean|string} withMarkingsOrKind — legacy bool, or 'arterial'|'residential'|'plain'|'path'
 * @param {string} [highway] — OSM highway tag (preferred)
 */
export function getRoadMaterial(color, withMarkingsOrKind = false, highway) {
  let kind =
    typeof withMarkingsOrKind === "string"
      ? withMarkingsOrKind
      : withMarkingsOrKind
        ? "arterial"
        : "plain";
  if (highway) kind = roadMarkKind(highway);
  // Only the decal path (highway given) is cached: its callers apply the same
  // idempotent tweaks every time. The bridge deck mutates its copy, so it stays unique.
  const ck = highway ? `${kind}|${color}` : null;
  if (ck && matCache.road.has(ck)) return matCache.road.get(ck);
  if (!cache.road[kind]) cache.road[kind] = makeRoadTexture(kind);
  if (!cache.normals.asphalt) cache.normals.asphalt = makeNormalMap("asphalt");
  // M1: asphalt was baked at 0.92 roughness with roughness:1 on top, i.e.
  // almost perfectly matte — streetlights and headlights could not leave a
  // specular streak, which is the main reason night roads looked like paint.
  // Real asphalt is ~0.55-0.65 and goes glassy when wet.
  if (!cache.rough.asphalt) cache.rough.asphalt = makeRoughnessMap(0.62);
  // Near-white multiply so the asphalt albedo carries the look; keep a light class tint
  const tint =
    kind === "path"
      ? color
      : new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex();
  const mat = new THREE.MeshStandardMaterial({
    color: tint,
    map: cache.road[kind],
    normalMap: cache.normals.asphalt,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: cache.rough.asphalt,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    envMapIntensity: 0.55,
  });
  applyRoadWetness(mat, currentRoadWetness);
  roadMaterials.add(mat);
  mat.addEventListener("dispose", () => roadMaterials.delete(mat));
  if (ck) {
    mat.userData.shared = true;
    matCache.road.set(ck, mat);
  }
  return mat;
}

/**
 * M1/M7: every road material is registered so weather can drive surface state.
 * wet = 0 dry asphalt, wet = 1 rain-slick (low roughness + strong env
 * reflection) which is what produces mirror streaks under streetlights.
 */
export function setRoadWetness(wet = 0) {
  currentRoadWetness = Math.max(0, Math.min(1, wet));
  for (const m of roadMaterials) {
    if (!m) continue;
    applyRoadWetness(m, currentRoadWetness);
  }
}
export function roadMaterialCount() {
  return roadMaterials.size;
}

export function getRailMaterial() {
  if (!cache.rail) cache.rail = makeRailTexture();
  if (!cache.normals.asphalt) cache.normals.asphalt = makeNormalMap("asphalt");
  return new THREE.MeshStandardMaterial({
    map: cache.rail,
    normalMap: cache.normals.asphalt,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 0.85,
    metalness: 0.15,
    envMapIntensity: 0.35,
  });
}

/** Simple colored PBR (water, landuse, clutter). */
export function getSimpleStandard(
  color,
  {
    transparent = false,
    opacity = 1,
    roughness = 0.7,
    metalness = 0,
    vertexColors = false,
    flatShading = false,
    side = THREE.FrontSide,
    polygonOffset = 0, // 0 = off; otherwise factor = units = this value
  } = {}
) {
  // Flags that change the shader are part of the key, so callers never need
  // to mutate the returned (shared) material.
  const ck = `${color}|${transparent}|${opacity}|${roughness}|${metalness}|${vertexColors}|${flatShading}|${side}|${polygonOffset}`;
  if (matCache.simple.has(ck)) return matCache.simple.get(ck);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent,
    opacity,
    vertexColors,
    flatShading,
    side,
    polygonOffset: polygonOffset !== 0,
    polygonOffsetFactor: polygonOffset,
    polygonOffsetUnits: polygonOffset,
    envMapIntensity: 0.45,
  });
  mat.userData.shared = true;
  matCache.simple.set(ck, mat);
  return mat;
}

// Atlas textures outlive individual cells; dispose once when the engine closes.
export function sharedMaterialTextures() {
  return [cache.facade, cache.lit, cache.rail, ...Object.values(cache.normals), ...Object.values(cache.rough), ...Object.values(cache.road)].filter(Boolean);
}

/** Current contents of the shared factory caches, including keys for fragmentation audits. */
export function materialFactoryInventory() {
  const factories = {};
  for (const [family, entries] of Object.entries(matCache)) {
    factories[family] = [...entries.entries()].map(([key, material]) => ({
      key,
      uuid: material.uuid,
      type: material.type,
    }));
  }
  return {
    factories,
    roadMaterialCount: roadMaterials.size,
    sharedTextureCount: sharedMaterialTextures().length,
    textureFamilies: {
      normals: Object.keys(cache.normals),
      roughness: Object.keys(cache.rough),
      roads: Object.keys(cache.road),
      facade: !!cache.facade,
      litWindows: !!cache.lit,
      rail: !!cache.rail,
    },
  };
}

export function disposeMaterialCache() {
  for (const texture of new Set(sharedMaterialTextures())) texture.dispose();
  cache.facade = cache.lit = cache.rail = null;
  cache.normals = {}; cache.rough = {}; cache.road = {};
  for (const m of Object.values(matCache)) {
    for (const mat of m.values()) mat.dispose();
    m.clear();
  }
  roadMaterials.clear();
}
