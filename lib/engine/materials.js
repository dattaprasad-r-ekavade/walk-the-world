// PBR material factory (plan 17.1): MeshStandardMaterial with procedural
// albedo + normal + roughness. Optional CC0 maps at /textures/*.jpg override
// when present (Poly Haven / ambientCG hosted on R2 or public/).
import * as THREE from "three";
import { makeRoadTexture, makeRailTexture } from "@/lib/engine/textures";
import { makeFacadeAtlas, makeLitWindowAtlas } from "@/lib/engine/facade-uv";

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

const cache = {
  facade: null,
  lit: null,
  normals: {},
  rough: {},
  road: {},
  rail: null,
};

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
  if (!cache.facade) cache.facade = makeFacadeAtlas();
  if (!cache.lit) cache.lit = makeLitWindowAtlas();
  const normal = facadeNormalFor(materialKey);
  const roughKey = materialKey || "plaster";
  if (!cache.rough[roughKey]) {
    const r = /glass|metal|steel/.test(roughKey || "") ? 0.25 : /brick|stone/.test(roughKey || "") ? 0.85 : 0.72;
    cache.rough[roughKey] = makeRoughnessMap(r);
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    map: cache.facade,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: cache.rough[roughKey],
    roughness: 1,
    metalness: /metal|steel|glass/.test(materialKey || "") ? 0.35 : 0.02,
    vertexColors: true,
    emissive: 0xffffff,
    emissiveMap: cache.lit,
    emissiveIntensity: 0,
    envMapIntensity: 0.55,
  });
  mat.userData.pbr = true;
  return mat;
}

export function getRoofMaterial(color, pitched = false) {
  if (!cache.normals.concrete) cache.normals.concrete = makeNormalMap("concrete");
  if (!cache.rough.roof) cache.rough.roof = makeRoughnessMap(pitched ? 0.78 : 0.88);
  return new THREE.MeshStandardMaterial({
    color,
    normalMap: cache.normals.concrete,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: cache.rough.roof,
    roughness: 1,
    metalness: 0.05,
    flatShading: pitched,
    envMapIntensity: 0.4,
  });
}

export function getRoadMaterial(color, withMarkings) {
  const key = withMarkings ? "marked" : "plain";
  if (!cache.road[key]) cache.road[key] = makeRoadTexture(withMarkings);
  if (!cache.normals.asphalt) cache.normals.asphalt = makeNormalMap("asphalt");
  if (!cache.rough.asphalt) cache.rough.asphalt = makeRoughnessMap(0.92);
  return new THREE.MeshStandardMaterial({
    color,
    map: cache.road[key],
    normalMap: cache.normals.asphalt,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: cache.rough.asphalt,
    roughness: 1,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    envMapIntensity: 0.25,
  });
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
export function getSimpleStandard(color, { transparent = false, opacity = 1, roughness = 0.7, metalness = 0 } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent,
    opacity,
    envMapIntensity: 0.45,
  });
}
