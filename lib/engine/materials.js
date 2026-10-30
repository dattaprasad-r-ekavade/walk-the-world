// PBR material factory (plan 17.1): MeshStandardMaterial with procedural
// albedo + normal + roughness. Optional CC0 maps at /textures/*.jpg override
// when present (Poly Haven / ambientCG hosted on R2 or public/).
import * as THREE from "three";
import { makeGrassTexture, makeRoadTexture, makeRailTexture, makeSidewalkTexture } from "@/lib/engine/textures";
import { GROUND_SURFACE_STYLE } from "@/lib/engine/ground-surfaces";
import { makeFacadeAtlas, makeInteriorRoomAtlas, makeLitWindowAtlas } from "@/lib/engine/facade-uv";
import { INTERIOR_MAPPING_SHADER_VERSION, patchInteriorMappingShader } from "@/lib/engine/interior-mapping";
import { createSeededRandom } from "@/lib/engine/random";
import { normalizeBuildingMaterial } from "@/lib/engine/styles";

function makeNormalMap(kind) {
  const random = createSeededRandom(`normal-map:${kind}:v1`);
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
      const n = 110 + random() * 40;
      g.fillStyle = `rgb(${n},${n},${200 + random() * 40})`;
      g.fillRect(random() * 128, random() * 128, 2, 2);
    }
  } else if (kind === "plaster") {
    for (let i = 0; i < 200; i++) {
      const n = 120 + random() * 20;
      g.fillStyle = `rgb(${n},${n},${230})`;
      g.fillRect(random() * 128, random() * 128, 3, 3);
    }
  } else if (kind === "concrete") {
    for (let i = 0; i < 150; i++) {
      g.fillStyle = `rgb(${100 + random() * 40},${100 + random() * 40},240)`;
      g.fillRect(random() * 128, random() * 128, 4, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function makeRoughnessMap(roughBase = 0.7) {
  const random = createSeededRandom(`roughness-map:${roughBase}:v1`);
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const v = Math.round(roughBase * 255);
  g.fillStyle = `rgb(${v},${v},${v})`;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 80; i++) {
    const d = Math.round((random() - 0.5) * 40);
    const n = Math.max(0, Math.min(255, v + d));
    g.fillStyle = `rgb(${n},${n},${n})`;
    g.fillRect(random() * 64, random() * 64, 3, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function makeWetAsphaltRoughnessMap() {
  const random = createSeededRandom("roughness-map:asphalt-wet-patches:v1");
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  // Keep the dry asphalt map for dry conditions. Under rain, use the same
  // existing roughness-map sampler with elongated, low-roughness patches to
  // break up the uniform highlight without adding a shader or render pass.
  g.fillStyle = "rgb(217,217,217)";
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 14; i++) {
    const width = 2 + random() * 6;
    const height = 6 + random() * 16;
    const value = Math.round(82 + random() * 40);
    g.fillStyle = `rgb(${value},${value},${value})`;
    g.fillRect(random() * (64 - width), random() * (64 - height), width, height);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Material instances shared across cells (flagged userData.shared so cell eviction skips them).
const matCache = { building: new Map(), roof: new Map(), road: new Map(), simple: new Map(), ground: new Map() };
const cache = {
  facade: null,
  lit: null,
  interiorRooms: null,
  nearFacade: null,
  normals: {},
  rough: {},
  road: {},
  sidewalk: null,
  rail: null,
  grass: null,
};
const roadMaterials = new Set();
let currentRoadWetness = 0;
let roadEnvironment = null;
let wetRoadMapCandidate = false;
let buildingTextureQuality = "shared";
const interiorIntensityUniform = { value: 0 };

const BUILDING_ATLAS_FAMILY = {
  plaster: "Plaster004",
  brick: "Bricks060",
  stone: "Rocks025",
  concrete: "Concrete034",
  metal: "Concrete034",
  glass: "Concrete034",
  wood: "Plaster004",
  other: "Plaster004",
};
const atlasRectUniforms = new Map();

function getAtlasRectUniform(familyKey) {
  if (!atlasRectUniforms.has(familyKey)) {
    atlasRectUniforms.set(familyKey, { value: new THREE.Vector4(0, 0, 1, 1) });
  }
  return atlasRectUniforms.get(familyKey);
}

function updateBuildingMaterialTextures(material) {
  const near = buildingTextureQuality === "high" ? cache.nearFacade : null;
  const familyKey = material.userData.materialFamily || "other";
  const atlasUniform = material.userData.wtwAtlasRect;
  let map = cache.facade;
  let emissiveMap = cache.lit;
  let normalMap = material.userData.sharedNormalMap;
  let roughnessMap = material.userData.sharedRoughnessMap;

  if (near) {
    const atlasKey = BUILDING_ATLAS_FAMILY[familyKey] || "Plaster004";
    const rect = near.materialRects?.[atlasKey]?.uvRectBottomLeft;
    if (rect) {
      map = near.basecolor;
      normalMap = near.normal;
      roughnessMap = near.roughness;
      emissiveMap = near.emissive;
      atlasUniform.value.set(rect[0], rect[1], rect[2], rect[3]);
    }
  } else {
    atlasUniform?.value.set(0, 0, 1, 1);
  }

  if (material.map !== map || material.normalMap !== normalMap ||
      material.roughnessMap !== roughnessMap || material.emissiveMap !== emissiveMap) {
    material.map = map;
    material.normalMap = normalMap;
    material.roughnessMap = roughnessMap;
    material.emissiveMap = emissiveMap;
    material.needsUpdate = true;
  }
}

function addBuildingAtlasUvShader(material, familyKey) {
  const atlasRect = getAtlasRectUniform(familyKey);
  material.userData.wtwAtlasRect = atlasRect;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wtwAtlasRect = atlasRect;
    patchInteriorMappingShader(shader, cache.interiorRooms, interiorIntensityUniform);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      [
        "#include <common>",
        "uniform vec4 wtwAtlasRect;",
        "vec2 wtwAtlasUv( vec2 uv ) {",
        "  float atlasMode = step( wtwAtlasRect.w, 0.999999 );",
        "  float localV = 1.0 - uv.y;",
        "  vec2 atlasUv = vec2( wtwAtlasRect.x + wtwAtlasRect.z * fract( uv.x ), 1.0 - ( wtwAtlasRect.y + wtwAtlasRect.w * localV ) );",
        "  return mix( uv, atlasUv, atlasMode );",
        "}",
      ].join("\n"),
    );
    for (const [chunk, varying] of [
      ["map_fragment", "vMapUv"],
      ["normal_fragment_maps", "vNormalMapUv"],
      ["roughnessmap_fragment", "vRoughnessMapUv"],
      ["emissivemap_fragment", "vEmissiveMapUv"],
    ]) {
      const include = "#include <" + chunk + ">";
      shader.fragmentShader = shader.fragmentShader.replace(
        include,
        "#define " + varying + " wtwAtlasUv( " + varying + " )\n" +
          include + "\n#undef " + varying,
      );
    }
  };
  // The shader text is identical for every family; only the atlas-rect uniform
  // differs, and three runs onBeforeCompile per material even when it reuses a
  // program, so each material still binds its own family's uniform. Keeping
  // the family out of the key lets families share one program: a Tokyo spawn
  // linked 23 building programs before, ~6 s of shader work on an Intel UHD.
  material.customProgramCacheKey = () => `wtw-building-atlas-interior-v${INTERIOR_MAPPING_SHADER_VERSION}`;
}

function applyRoadWetness(material, wetness) {
  // Wet asphalt absorbs more diffuse light. Keep the dry albedo so repeated
  // weather changes remain reversible and update only the existing color
  // uniform; no texture upload or shader feature is added.
  material.userData.dryRoadColor ||= material.color.clone();
  material.userData.dryRoadRoughnessMap ||= material.roughnessMap;
  material.color.copy(material.userData.dryRoadColor).multiplyScalar(1 - wetness * 0.14);
  material.roughness = 1 - wetness * 0.88; // 1.0 dry -> 0.12 rain-slick
  if (wetRoadMapCandidate && wetness >= 0.3) {
    if (!cache.rough.wetAsphalt) cache.rough.wetAsphalt = makeWetAsphaltRoughnessMap();
    material.roughnessMap = cache.rough.wetAsphalt;
  } else {
    material.roughnessMap = material.userData.dryRoadRoughnessMap;
  }
  // Smooth the asphalt's micro-normal as water fills the pores, then raise
  // only this material's existing PMREM response so the same light/sky sources
  // read on wet roads without adding another render pass or shader lobe.
  material.normalScale?.setScalar(0.55 - wetness * 0.4);
  material.envMapIntensity = 0.55 + wetness * 2.4;
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
  if (!cache.interiorRooms) cache.interiorRooms = makeInteriorRoomAtlas();
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
  mat.userData.materialFamily = familyKey || "other";
  mat.userData.sharedNormalMap = normal;
  mat.userData.sharedRoughnessMap = cache.rough[roughKey];
  addBuildingAtlasUvShader(mat, mat.userData.materialFamily);
  updateBuildingMaterialTextures(mat);
  mat.userData.pbr = true;
  mat.userData.shared = true; // cached across cells; see disposeSceneGroup
  matCache.building.set(ck, mat);
  return mat;
}

/** Install shared runtime facade maps after KTX2 transcode and GPU upload. */
export function installBuildingTextureMaps({ facade, emissive }) {
  if (!facade || !emissive) return false;
  const previous = new Set([cache.facade, cache.lit].filter(Boolean));
  cache.facade = facade;
  cache.lit = emissive;
  for (const material of matCache.building.values()) {
    updateBuildingMaterialTextures(material);
  }
  for (const texture of previous) {
    if (texture !== facade && texture !== emissive) texture.dispose();
  }
  return true;
}

/** Install packed facade maps for high quality building detail. */
export function installBuildingNearTextureMaps({ basecolor, normal, roughness, emissive, materialRects }) {
  if (!basecolor || !normal || !roughness || !emissive || !materialRects) return false;
  cache.nearFacade = { basecolor, normal, roughness, emissive, materialRects };
  for (const material of matCache.building.values()) updateBuildingMaterialTextures(material);
  return true;
}

/** Detach high-tier atlases from shared materials before their GPU textures are disposed. */
export function clearBuildingNearTextureMaps() {
  if (!cache.nearFacade) return false;
  buildingTextureQuality = "shared";
  cache.nearFacade = null;
  for (const material of matCache.building.values()) updateBuildingMaterialTextures(material);
  return true;
}

/** Select packed atlases only for the high quality tier. */
export function setBuildingTextureQuality(quality) {
  buildingTextureQuality = quality === "high" ? "high" : "shared";
  for (const material of matCache.building.values()) updateBuildingMaterialTextures(material);
  return buildingTextureQuality === "high" && !!cache.nearFacade;
}

/** Dusk/night controller for the shared room atlas shader uniform. */
export function setInteriorMappingLighting(intensity = 0) {
  interiorIntensityUniform.value = THREE.MathUtils.clamp(Number(intensity) || 0, 0, 1);
  return interiorIntensityUniform.value;
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
export function getRoadMaterial(color, withMarkingsOrKind = false, highway, markingProfile = {}) {
  let kind =
    typeof withMarkingsOrKind === "string"
      ? withMarkingsOrKind
      : withMarkingsOrKind
        ? "arterial"
        : "plain";
  if (highway) kind = roadMarkKind(highway);
  const lanes = Math.max(0, Math.min(8, Math.round(Number(markingProfile?.lanes) || 0)));
  const oneWay = markingProfile?.oneWay === true;
  const textureKey = `${kind}|${lanes}|${oneWay ? 1 : 0}`;
  // Only the decal path (highway given) is cached: its callers apply the same
  // idempotent tweaks every time. The bridge deck mutates its copy, so it stays unique.
  const ck = highway ? `${kind}|${color}|${lanes}|${oneWay ? 1 : 0}` : null;
  if (ck && matCache.road.has(ck)) return matCache.road.get(ck);
  if (!cache.road[textureKey]) cache.road[textureKey] = makeRoadTexture(kind, { lanes, oneWay });
  if (!cache.normals.asphalt) cache.normals.asphalt = makeNormalMap("asphalt");
  // M1: asphalt was baked at 0.92 roughness with roughness:1 on top, i.e.
  // almost perfectly matte — streetlights and headlights could not leave a
  // specular streak, which is the main reason night roads looked like paint.
  // Real asphalt is ~0.55-0.65 and goes glassy when wet.
  if (!cache.rough.asphalt) cache.rough.asphalt = makeRoughnessMap(0.72);
  // Near-white multiply so the asphalt albedo carries the look; keep a light class tint
  const tint =
    kind === "path"
      ? color
      : new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex();
  const mat = new THREE.MeshStandardMaterial({
    color: tint,
    map: cache.road[textureKey],
    normalMap: cache.normals.asphalt,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: cache.rough.asphalt,
    roughness: 1,
    metalness: 0,
    envMap: roadEnvironment,
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

/** Shared paved walkway material; its texture is disposed with the engine cache. */
export function getSidewalkMaterial() {
  if (cache.sidewalk) return cache.sidewalk;
  const map = typeof document !== "undefined" ? makeSidewalkTexture() : null;
  cache.sidewalk = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    roughness: 0.94,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  cache.sidewalk.userData.shared = true;
  return cache.sidewalk;
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

// Experimental map is opt-in for benchmark comparisons until accepted.
export function setWetRoadMapCandidate(enabled) {
  wetRoadMapCandidate = enabled === true;
  for (const material of roadMaterials) applyRoadWetness(material, currentRoadWetness);
  return wetRoadMapStats();
}
export function wetRoadMapStats() {
  return {
    enabled: wetRoadMapCandidate,
    materialCount: roadMaterials.size,
    candidateCount: cache.rough.wetAsphalt
      ? [...roadMaterials].filter((material) => material.roughnessMap === cache.rough.wetAsphalt).length
      : 0,
  };
}

// The scene environment is owned by the environment controller. Explicitly
// bind it so Three.js uses each road material's envMapIntensity uniform.
export function setRoadEnvironment(texture) {
  if (roadEnvironment === texture) return;
  const changedPresence = Boolean(roadEnvironment) !== Boolean(texture);
  roadEnvironment = texture;
  for (const material of roadMaterials) {
    material.envMap = texture;
    if (changedPresence) material.needsUpdate = true;
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

/**
 * Shared material for one ground-surface kind (plan B3). Textured kinds use
 * the world-space UVs the builder writes, so maps tile across areas and cells.
 */
export function getGroundSurfaceMaterial(kind) {
  if (matCache.ground.has(kind)) return matCache.ground.get(kind);
  const style = GROUND_SURFACE_STYLE[kind] || GROUND_SURFACE_STYLE.grass;
  const canvas = typeof document !== "undefined";
  let map = null;
  let normalMap = null;
  if (canvas && style.texture === "grass") {
    if (!cache.grass) cache.grass = makeGrassTexture();
    map = cache.grass;
  } else if (canvas && style.texture === "paving") {
    // Same slabs as the street sidewalks so plazas and pavements match.
    map = getSidewalkMaterial().map;
  } else if (canvas && style.texture === "asphalt") {
    if (!cache.normals.asphalt) cache.normals.asphalt = makeNormalMap("asphalt");
    normalMap = cache.normals.asphalt;
  }
  const mat = new THREE.MeshStandardMaterial({
    color: style.color,
    map,
    normalMap,
    roughness: style.roughness ?? 0.85,
    metalness: style.metalness ?? 0,
    envMapIntensity: 0.45,
  });
  if (normalMap) mat.normalScale.set(0.35, 0.35);
  mat.userData.shared = true;
  matCache.ground.set(kind, mat);
  return mat;
}

// Atlas textures outlive individual cells; dispose once when the engine closes.
export function sharedMaterialTextures() {
  const nearTextures = cache.nearFacade
    ? [cache.nearFacade.basecolor, cache.nearFacade.normal, cache.nearFacade.roughness, cache.nearFacade.emissive]
    : [];
  return [cache.facade, cache.lit, cache.interiorRooms, cache.rail, cache.sidewalk?.map, cache.grass, roadEnvironment, ...nearTextures, ...Object.values(cache.normals), ...Object.values(cache.rough), ...Object.values(cache.road)].filter(Boolean);
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
      interiorRooms: !!cache.interiorRooms,
      highFacadeAtlases: !!cache.nearFacade,
      rail: !!cache.rail,
      sidewalk: !!cache.sidewalk,
    },
  };
}

export function disposeMaterialCache() {
  for (const texture of new Set(sharedMaterialTextures())) texture.dispose();
  cache.sidewalk?.dispose();
  cache.sidewalk = null;
  cache.facade = cache.lit = cache.interiorRooms = cache.nearFacade = cache.rail = cache.grass = null;
  cache.normals = {}; cache.rough = {}; cache.road = {};
  buildingTextureQuality = "shared";
  interiorIntensityUniform.value = 0;
  for (const m of Object.values(matCache)) {
    for (const mat of m.values()) mat.dispose();
    m.clear();
  }
  roadMaterials.clear();
  roadEnvironment = null;
  wetRoadMapCandidate = false;
  atlasRectUniforms.clear();
}
