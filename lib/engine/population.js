// Populated world: instanced pedestrians walking the street graph, cars
// following road centerlines, boid-ish birds, and POI sign sprites.
// All data comes from the already-parsed city (roadPaths + POI nodes) —
// no extra network requests. Everything renders in a handful of draw calls:
// one InstancedMesh for peds, one for cars, one for birds.
import * as THREE from "three";
import { createWalkPedMaterials, setWalkPedTime } from "@/lib/engine/ped-walk";

const PED_MAX = 140;
const CAR_MAX = 70;
const BIRD_MAX = 36;

// how busy the streets are by hour (0-23) — lunch rush, dead at 4am
const hourFactor = (h) => {
  if (h < 5) return 0.12;
  if (h < 8) return 0.3 + (h - 5) * 0.2;
  if (h < 11) return 0.9;
  if (h < 14) return 1.0; // lunch
  if (h < 18) return 0.85;
  if (h < 22) return 1.0; // evening
  return 0.35;
};

const CAR_SPEED = {
  motorway: 25, trunk: 22, primary: 16, secondary: 14, tertiary: 12,
  residential: 8, unclassified: 8, living_street: 5, service: 5,
};

// Tier-0 traffic: relative spawn weight by highway class (no live API).
const CAR_DENSITY = {
  motorway: 3.2, trunk: 2.8, primary: 2.4, secondary: 1.8, tertiary: 1.3,
  residential: 0.7, unclassified: 0.6, living_street: 0.35, service: 0.25,
};

/** Rush / night congestion on arterials (0–1 speed multiplier). */
function congestionFactor(hour, hw) {
  const arterial = /^(motorway|trunk|primary|secondary)$/.test(hw || "");
  let c = 1;
  if (hour >= 7 && hour < 10) c = arterial ? 0.45 : 0.7; // morning rush
  else if (hour >= 16 && hour < 20) c = arterial ? 0.4 : 0.65; // evening rush
  else if (hour >= 11 && hour < 14) c = arterial ? 0.75 : 0.9; // midday
  else if (hour < 5 || hour >= 23) c = 1.15; // night free-flow
  return c;
}

function pickWeightedRoad(roads, random = Math.random) {
  if (!roads.length) return null;
  let total = 0;
  const weights = roads.map((w) => {
    const d = (CAR_DENSITY[w.hw] || 0.5) * (w.oneway ? 1.15 : 1) * Math.min(2, (w.width || 6) / 7);
    total += d;
    return d;
  });
  let r = random() * total;
  for (let i = 0; i < roads.length; i++) {
    r -= weights[i];
    if (r <= 0) return roads[i];
  }
  return roads[roads.length - 1];
}

/**
 * Push a POI label out of a building footprint onto the nearest exterior face.
 * If roadPaths are given, prefer the side facing the nearest road (storefront).
 */
export function placeOutsideBuilding(x, z, insideBuilding, opts = {}) {
  const maxR = opts.maxR ?? 28;
  const roads = opts.roadPaths || [];
  if (!insideBuilding) return { x, z, moved: false };

  // Bias toward nearest road centerline sample (shop fronts face the street)
  let preferX = 0;
  let preferZ = 0;
  let preferW = 0;
  if (roads.length) {
    let bestD = Infinity;
    for (const rp of roads) {
      const pts = rp.pts || [];
      for (let i = 0; i < pts.length; i += Math.max(1, (pts.length / 10) | 0)) {
        const d = Math.hypot(pts[i].x - x, pts[i].y - z);
        if (d < bestD) {
          bestD = d;
          preferX = pts[i].x - x;
          preferZ = pts[i].y - z;
          preferW = 1;
        }
      }
    }
    const len = Math.hypot(preferX, preferZ) || 1;
    preferX /= len;
    preferZ /= len;
  }

  const alreadyOut = !insideBuilding(x, z);
  if (alreadyOut && preferW) {
    // still nudge toward street a bit if we're in a courtyard / setback
    const nx = x + preferX * 2.2;
    const nz = z + preferZ * 2.2;
    if (!insideBuilding(nx, nz)) {
      return { x: nx, z: nz, moved: true, faceX: preferX, faceZ: preferZ };
    }
    return { x, z, moved: false, faceX: preferX, faceZ: preferZ };
  }
  if (alreadyOut) {
    return {
      x,
      z,
      moved: false,
      faceX: preferW ? preferX : 0,
      faceZ: preferW ? preferZ : 1,
    };
  }

  // Prefer search along the road-facing half-plane first
  const tryPoint = (nx, nz) => {
    if (insideBuilding(nx, nz)) return null;
    const ox = nx + (preferW ? preferX * 1.2 : 0);
    const oz = nz + (preferW ? preferZ * 1.2 : 0);
    if (!insideBuilding(ox, oz)) return { x: ox, z: oz };
    return { x: nx, z: nz };
  };

  const withFace = (hit) => {
    if (!hit) return null;
    let fx = preferW ? preferX : hit.x - x;
    let fz = preferW ? preferZ : hit.z - z;
    const len = Math.hypot(fx, fz) || 1;
    return { ...hit, moved: true, faceX: fx / len, faceZ: fz / len };
  };

  if (preferW) {
    for (let r = 1.5; r <= maxR; r += 1.1) {
      const hit = withFace(tryPoint(x + preferX * r, z + preferZ * r));
      if (hit) return hit;
      for (const ang of [-0.6, 0.6, -1.1, 1.1]) {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const dx = preferX * c - preferZ * s;
        const dz = preferX * s + preferZ * c;
        const h2 = withFace(tryPoint(x + dx * r, z + dz * r));
        if (h2) return h2;
      }
    }
  }

  for (let r = 1.5; r <= maxR; r += 1.25) {
    const steps = Math.max(8, Math.round((Math.PI * 2 * r) / 2.2));
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const hit = withFace(tryPoint(x + Math.cos(a) * r, z + Math.sin(a) * r));
      if (!hit) continue;
      const d = Math.hypot(hit.x - x, hit.z - z);
      const score = d - (preferW ? (hit.x - x) * preferX + (hit.z - z) * preferZ * 0.5 : 0);
      if (score < bestD) {
        bestD = score;
        best = hit;
      }
    }
    if (best) return best;
  }
  return { x, z, moved: false, faceX: preferW ? preferX : 0, faceZ: preferW ? preferZ : 1 };
}

/** Unit direction from (x, z) to the closest point on any road segment, or null. */
function nearestRoadDir(x, z, roads) {
  let bestD = Infinity, dx = 0, dz = 0;
  for (const rp of roads) {
    const pts = rp.pts || [];
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x, az = pts[i - 1].y;
      const sx = pts[i].x - ax, sz = pts[i].y - az;
      const L2 = sx * sx + sz * sz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / L2));
      const qx = ax + sx * t - x, qz = az + sz * t - z;
      const d = Math.hypot(qx, qz);
      if (d < bestD) { bestD = d; dx = qx; dz = qz; }
    }
  }
  if (!Number.isFinite(bestD) || bestD < 1e-6) return null;
  return { x: dx / bestD, z: dz / bestD, dist: bestD };
}

/**
 * Mount a shop sign flat on a building wall instead of floating it in front:
 * pick the footprint edge nearest the POI, favouring edges whose outward
 * normal faces the street, and keep the plate inside that edge's length.
 * Edges whose outside is another building (party walls in terraces) are
 * skipped. Returns null when no wall is within maxD.
 */
export function mountOnFacade(x, z, footprints, opts = {}) {
  const maxD = opts.maxD ?? 10;
  const halfW = opts.halfW ?? 3;
  const blocked = opts.insideBuilding || (() => false);
  const road = opts.roadPaths?.length ? nearestRoadDir(x, z, opts.roadPaths) : null;
  let best = null;
  for (const fp of footprints) {
    const p = fp.poly;
    if (!p || p.length < 3) continue;
    let area = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) area += p[j][0] * p[i][1] - p[i][0] * p[j][1];
    const ccw = area > 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const ax = p[j][0], az = p[j][1];
      const ex = p[i][0] - ax, ez = p[i][1] - az;
      const len = Math.hypot(ex, ez);
      if (len < 2.5) continue;
      const ux = ex / len, uz = ez / len;
      // outward normal: right of the edge when the ring is CCW in the (x, z) plane
      const nx = ccw ? uz : -uz, nz = ccw ? -ux : ux;
      const t = (x - ax) * ux + (z - az) * uz;
      const tc = Math.max(0, Math.min(len, t));
      const d = Math.hypot(ax + ux * tc - x, az + uz * tc - z);
      if (d > maxD) continue;
      const w = Math.min(halfW, len / 2 - 0.3);
      const tm = Math.max(w + 0.3, Math.min(len - w - 0.3, t));
      const mx = ax + ux * tm, mz = az + uz * tm;
      if (blocked(mx + nx * 0.8, mz + nz * 0.8)) continue;
      // facing the road beats proximity; back/side walls only win when close
      const facing = road ? nx * road.x + nz * road.z : 0;
      const score = d - facing * 6 - Math.min(len, 12) * 0.15;
      if (!best || score < best.score)
        best = { score, x: mx + nx * 0.12, z: mz + nz * 0.12, faceX: nx, faceZ: nz, halfW: w, moved: true, fp };
    }
  }
  return best;
}

/** Building height in metres from OSM tags, or null when untagged. */
function tagHeight(tags) {
  const h = parseFloat(tags?.height);
  if (Number.isFinite(h) && h > 0) return h;
  const lv = parseFloat(tags?.["building:levels"]);
  return Number.isFinite(lv) && lv > 0 ? lv * 3 : null;
}

/**
 * Fixed-facing nameplate (NOT a Sprite — sprites always billboard and clip into walls).
 * faceX/faceZ = outward normal toward the street. opts.maxW caps the plate to its wall;
 * opts.y sets the height above ground.
 */
function makeNameplateSprite(label, groundHeight, x, z, faceX = 0, faceZ = 1, opts = {}) {
  const text = String(label || "").trim() || "?";
  const font = 'bold 28px system-ui, "Segoe UI", sans-serif';
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const tw = Math.ceil(measure.measureText(text).width);
  const padX = 28;
  const w = Math.min(640, Math.max(120, tw + padX * 2));
  const h = 56;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(10,14,22,0.88)";
  if (g.roundRect) {
    g.beginPath();
    g.roundRect(0, 0, w, h, 14);
    g.fill();
  } else {
    g.fillRect(0, 0, w, h);
  }
  g.strokeStyle = "rgba(255,217,122,0.55)";
  g.lineWidth = 2;
  if (g.roundRect) {
    g.beginPath();
    g.roundRect(1, 1, w - 2, h - 2, 13);
    g.stroke();
  }
  g.fillStyle = "#ffd97a";
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const worldW = Math.min(opts.maxW ?? 14, 4.5 + text.length * 0.28);
  // recorded for the placement assertion in getNameplateStats()
  const worldH = worldW * (h / w);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
  mesh.position.set(x, groundHeight(x, z) + (opts.y ?? 3.2), z);
  const fl = Math.hypot(faceX, faceZ) || 1;
  // Plane default normal is +Z; rotate so it faces the street
  mesh.rotation.y = Math.atan2(faceX / fl, faceZ / fl);
  mesh.renderOrder = 2;
  mesh.userData.poiX = x;
  mesh.userData.poiZ = z;
  mesh.userData.halfW = worldW / 2;
  mesh.userData.faceX = faceX;
  mesh.userData.faceZ = faceZ;
  mesh.userData.dispose = () => {
    tex.dispose();
    mat.dispose();
    mesh.geometry.dispose();
  };
  return mesh;
}

function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

// position + direction at distance d along a polyline of Vector2 (x, .y=z)
// Returns a shared scratch object (callers read it immediately) — no per-call alloc.
const SAMPLE = { x: 0, z: 0, dx: 0, dz: 1 };
function sampleAt(pts, cum, d, out = SAMPLE) {
  if (!pts?.length || !cum?.length) { out.x = 0; out.z = 0; out.dx = 0; out.dz = 1; return out; }
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1] || pts[0];
  const b = pts[i] || pts[pts.length - 1] || a;
  if (!a || !b) { out.x = 0; out.z = 0; out.dx = 0; out.dz = 1; return out; }
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - (cum[i - 1] || 0)) / seg));
  const x = a.x + (b.x - a.x) * t;
  const z = a.y + (b.y - a.y) * t;
  out.x = x;
  out.z = z;
  out.dx = (b.x - a.x) / seg;
  out.dz = (b.y - a.y) / seg;
  return out;
}

function makePedGeometry() {
  const g = new THREE.BoxGeometry(0.42, 1.15, 0.28);
  g.translate(0, 0.575, 0);
  const head = new THREE.SphereGeometry(0.16, 6, 5);
  head.translate(0, 1.32, 0);
  const merged = new THREE.BufferGeometry();
  // cheap merge: concat positions/normals via three's utils-free path
  const geos = [g, head];
  let vtx = 0, idx = 0;
  for (const gg of geos) { vtx += gg.attributes.position.count; idx += gg.index.count; }
  const pos = new Float32Array(vtx * 3), nor = new Float32Array(vtx * 3);
  const ind = new Uint16Array(idx);
  let vo = 0, io = 0;
  for (const gg of geos) {
    pos.set(gg.attributes.position.array, vo * 3);
    nor.set(gg.attributes.normal.array, vo * 3);
    const gi = gg.index.array;
    for (let k = 0; k < gi.length; k++) ind[io + k] = gi[k] + vo;
    vo += gg.attributes.position.count;
    io += gi.length;
    gg.dispose();
  }
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  merged.setIndex(new THREE.BufferAttribute(ind, 1));
  return merged;
}

function makeCarGeometry() {
  const body = new THREE.BoxGeometry(1.7, 0.55, 4.0);
  body.translate(0, 0.55, 0);
  const cabin = new THREE.BoxGeometry(1.5, 0.5, 2.0);
  cabin.translate(0, 1.05, -0.2);
  const geos = [body, cabin];
  let vtx = 0, idx = 0;
  for (const gg of geos) { vtx += gg.attributes.position.count; idx += gg.index.count; }
  const pos = new Float32Array(vtx * 3), nor = new Float32Array(vtx * 3);
  const ind = new Uint16Array(idx);
  let vo = 0, io = 0;
  for (const gg of geos) {
    pos.set(gg.attributes.position.array, vo * 3);
    nor.set(gg.attributes.normal.array, vo * 3);
    const gi = gg.index.array;
    for (let k = 0; k < gi.length; k++) ind[io + k] = gi[k] + vo;
    vo += gg.attributes.position.count;
    io += gi.length;
    gg.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  merged.setIndex(new THREE.BufferAttribute(ind, 1));
  return merged;
}

const PED_COLORS = [0xc94f4f, 0x4f6ec9, 0x4fc97a, 0xc9b44f, 0x9b4fc9, 0x767c85, 0xd98a3d, 0x3dbdd9];
const CAR_COLORS = [0xd8d8d8, 0x2b2b2e, 0xb33a3a, 0x2f4d8a, 0x9aa5b0, 0x5c6b52, 0xe0e0e0, 0x1f1f22];

// models: optional { car|bird|ped: { geometry, material } } overrides loaded
// from the asset library (upload car.glb / bird.glb / pedestrian.glb via
// /editor and traffic/birds/people use those instead of the built-in shapes).
// Custom models must face +Z.
/** 18.6 — simple timer cycle shared by all signals (seconds). */
const SIGNAL_CYCLE = 28; // red 12 + amber 3 + green 13
const SIGNAL_STOP_R = 14; // meters: stop if approaching within this

/**
 * Phase at world time t for a signal with phaseOffset.
 * @returns {'red'|'amber'|'green'}
 */
export function signalPhase(t, phaseOffset = 0) {
  const u = ((t + phaseOffset) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  if (u < 12) return "red";
  if (u < 15) return "amber";
  return "green";
}

/**
 * Distance along path to nearest signal within maxAlong, if car is heading toward it.
 * Signals are world (x,z); path pts use (x,y=z).
 */
function approachingSignal(w, d, dir, signals, maxAlong = 22) {
  if (!signals?.length || !w?.pts) return null;
  let best = null;
  let bestAlong = maxAlong;
  for (const sig of signals) {
    // find closest sample on this road
    let minD = Infinity;
    let along = 0;
    for (let i = 0; i < w.pts.length; i++) {
      const dd = Math.hypot(w.pts[i].x - sig.x, w.pts[i].y - sig.z);
      if (dd < minD) {
        minD = dd;
        along = w.cum[i];
      }
    }
    if (minD > SIGNAL_STOP_R) continue;
    const ahead = (along - d) * dir;
    if (ahead > 0.5 && ahead < bestAlong) {
      bestAlong = ahead;
      best = { along, dist: ahead, sig };
    }
  }
  return best;
}

export function createPopulation({
  scene,
  groundHeight,
  roadPaths,
  pois = [],
  models = {},
  signals = [],
  insideBuilding = null,
  footprintsNear = null,
  // Keep the living-world silhouette on low-end browsers without paying for
  // hidden instances every frame. The built-in caps remain the high preset.
  maxPeds = PED_MAX,
  maxCars = CAR_MAX,
  maxBirds = BIRD_MAX,
  random = Math.random,
}) {
  const PED_MAX = Math.max(16, Math.min(140, Math.floor(maxPeds)));
  const CAR_MAX = Math.max(8, Math.min(70, Math.floor(maxCars)));
  const BIRD_MAX = Math.max(8, Math.min(36, Math.floor(maxBirds)));
  // ---- street graph ----
  const walkable = [], drivable = [];
  for (const rp of roadPaths || []) {
    const hw = rp.tags?.highway;
    if (!hw || !rp.pts || rp.pts.length < 2) continue;
    const L = pathLength(rp.pts);
    if (L < 25) continue;
    const cum = [0];
    for (let i = 1; i < rp.pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(rp.pts[i].x - rp.pts[i - 1].x, rp.pts[i].y - rp.pts[i - 1].y));
    const rec = { pts: rp.pts, cum, L, width: rp.width || 6, hw, oneway: rp.tags?.oneway === "yes" };
    if (!/^(motorway|trunk|primary)/.test(hw)) walkable.push(rec);
    if (CAR_SPEED[hw]) drivable.push(rec);
  }

  // OSM traffic_signals → stop points (phase staggered by position)
  const signalList = (signals || [])
    .filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.z))
    .map((s, i) => ({
      x: s.x,
      z: s.z,
      phaseOffset: ((s.x * 0.17 + s.z * 0.13 + i * 3.7) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE,
    }));
  let signalClock = 0;

  // Project signals onto each road once. The previous per-frame search was
  // O(cars × signals × road points), which became visible in dense cities.
  // Cars now only scan a tiny sorted list of signal distances.
  const roadSignals = new Map();
  for (const road of drivable) {
    const projected = [];
    for (const sig of signalList) {
      let minD = Infinity;
      let along = 0;
      for (let i = 0; i < road.pts.length; i++) {
        const distance = Math.hypot(road.pts[i].x - sig.x, road.pts[i].y - sig.z);
        if (distance < minD) {
          minD = distance;
          along = road.cum[i];
        }
      }
      if (minD <= SIGNAL_STOP_R) projected.push({ along, sig });
    }
    projected.sort((a, b) => a.along - b.along);
    roadSignals.set(road, projected);
  }
  const signalHit = { along: 0, dist: 0, sig: null }; // scratch, read immediately
  const approachingCachedSignal = (road, distance, direction, maxAlong = 22) => {
    const projected = roadSignals.get(road);
    if (!projected?.length) return null;
    let best = null;
    let bestAlong = maxAlong;
    for (const item of projected) {
      const ahead = (item.along - distance) * direction;
      if (ahead > 0.5 && ahead < bestAlong) {
        bestAlong = ahead;
        signalHit.along = item.along;
        signalHit.dist = ahead;
        signalHit.sig = item.sig;
        best = signalHit;
      }
    }
    return best;
  };

  const group = new THREE.Group();
  scene.add(group);
  const dummy = new THREE.Object3D();
  const disposables = [];

  // Terrain sampling is a surprisingly large part of the population frame
  // budget: several agents often land on the same road sample. Quantize a
  // short-lived cache per simulation tick so detail stays identical while
  // duplicate height queries collapse to one lookup.
  // Numeric key (no string alloc); flushed on a short timer rather than every
  // frame, so streamed-in terrain still shows up within ~0.25 s.
  const terrainCache = new Map();
  let terrainAge = 0;
  const terrainHeight = (x, z) => {
    const key = (Math.round(x * 2) + 1048576) * 2097152 + (Math.round(z * 2) + 1048576);
    let value = terrainCache.get(key);
    if (value === undefined) {
      value = groundHeight(x, z);
      terrainCache.set(key, value);
    }
    return value;
  };

  // ---- density: POIs + road-class capacity (tier-0 traffic) ----
  const roadCapacity = drivable.reduce((s, w) => s + (CAR_DENSITY[w.hw] || 0.5), 0);
  const pedBase = Math.min(PED_MAX, Math.round(28 + pois.length * 1.4));
  const carBase = Math.min(CAR_MAX, Math.round(8 + roadCapacity * 1.1 + pois.length * 0.35));

  // ---- pedestrians ----
  let peds = null, pedList = [];
  let pedWalkMaterials = null;
  let pedTime = 0;
  if (walkable.length) {
    const geo = models.ped?.geometry || makePedGeometry();
    // Built-in peds use matching walk-cycle color/shadow shaders (15.1).
    // Custom GLB peds keep their own material and shadow behavior.
    if (!models.ped) pedWalkMaterials = createWalkPedMaterials(0xffffff);
    const mat = models.ped?.material || pedWalkMaterials.color;
    peds = new THREE.InstancedMesh(geo, mat, PED_MAX);
    peds.castShadow = true;
    if (pedWalkMaterials) {
      peds.customDepthMaterial = pedWalkMaterials.depth;
      peds.customDistanceMaterial = pedWalkMaterials.distance;
    }
    peds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // per-instance walk phase for the vertex shader
    const phases = new Float32Array(PED_MAX);
    for (let i = 0; i < PED_MAX; i++) phases[i] = random() * Math.PI * 2;
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    disposables.push(geo, mat);
    if (pedWalkMaterials) {
      disposables.push(pedWalkMaterials.depth, pedWalkMaterials.distance);
    }
    for (let i = 0; i < PED_MAX; i++) {
      const w = walkable[(random() * walkable.length) | 0];
      pedList.push({
        w,
        d: random() * w.L,
        dir: random() < 0.5 ? 1 : -1,
        speed: 1.1 + random() * 0.7,
        side: (random() < 0.5 ? -1 : 1) * (w.width / 2 + 0.6),
        phase: phases[i],
      });
      if (!models.ped) peds.setColorAt(i, new THREE.Color(PED_COLORS[i % PED_COLORS.length]));
    }
    if (peds.instanceColor) peds.instanceColor.needsUpdate = true;
    // Agents stay near the player and three computes the instanced bounding
    // sphere once (first-frame positions), so culling would be wrong. Counts are
    // small: disable culling rather than recompute the sphere.
    peds.frustumCulled = false;
    group.add(peds);
  }

  // ---- cars ----
  let cars = null, carList = [];
  let drivenIndex = -1;
  if (drivable.length) {
    const geo = models.car?.geometry || makeCarGeometry();
    const mat = models.car?.material || new THREE.MeshLambertMaterial();
    cars = new THREE.InstancedMesh(geo, mat, CAR_MAX);
    cars.castShadow = true;
    cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    disposables.push(geo, mat);
    for (let i = 0; i < CAR_MAX; i++) {
      const w = pickWeightedRoad(drivable, random);
      const baseSp = (CAR_SPEED[w.hw] || 8) * (0.85 + random() * 0.3);
      carList.push({
        w,
        d: random() * w.L,
        dir: w.oneway ? 1 : random() < 0.5 ? 1 : -1,
        speed: baseSp,
        baseSpeed: baseSp,
        h: null,
        y: null,
        px: 0,
        pz: 0,
        driven: false,
      });
      if (!models.car) cars.setColorAt(i, new THREE.Color(CAR_COLORS[i % CAR_COLORS.length]));
    }
    if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
    cars.frustumCulled = false; // see peds
    group.add(cars);
  }

  // ---- birds (cheap flock: orbiting a drifting centre) ----
  const birdGeo = models.bird?.geometry || (() => { const g = new THREE.ConeGeometry(0.18, 0.7, 4); g.rotateX(Math.PI / 2); return g; })();
  const birdMat = models.bird?.material || new THREE.MeshBasicMaterial({ color: 0x2c2f36 });
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, BIRD_MAX);
  birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  disposables.push(birdGeo, birdMat);
  const birdList = [];
  for (let i = 0; i < BIRD_MAX; i++)
    birdList.push({
      r: 14 + random() * 30,
      a: random() * Math.PI * 2,
      va: 0.25 + random() * 0.3,
      h: 22 + random() * 25,
      bob: random() * Math.PI * 2,
    });
  const flock = { x: 0, z: 0, t: 0 };
  birds.frustumCulled = false; // see peds
  group.add(birds);

  // ---- POI sign sprites (named shops/amenities; pushed outside footprints) ----
  const SIGN_SHOW_R = 90; // meters — street-scale; depthTest still hides through walls
  const SIGN_MAX = 18;
  const signs = [];
  const named = pois.filter((p) => p.name).slice(0, 80);
  // prefer denser POI clusters near spawn, then cull by player range each frame
  named.sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z));
  for (const p of named) {
    if (signs.length >= SIGN_MAX) break;
    const label = String(p.name || "");
    const wantHalfW = Math.min(14, 4.5 + label.length * 0.28) / 2;
    // Preferred: flat on the shop's own street-facing wall, sized to fit it.
    const wall = footprintsNear
      // real buildings only (meta.id); rails and generated props also register footprints
      ? mountOnFacade(p.x, p.z, footprintsNear(p.x, p.z, 12).filter((fp) => fp.meta?.id), { roadPaths: drivable, halfW: wantHalfW, insideBuilding })
      : null;
    if (wall) {
      if (wall.halfW < 1.4) continue; // wall too narrow for a legible plate
      // several shops in one building land on the same wall: never overlap plates
      const overlaps = signs.some((o) => {
        const u = o.userData;
        if (u.faceX * wall.faceX + u.faceZ * wall.faceZ < 0.9) return false;
        const dx = o.position.x - wall.x, dz = o.position.z - wall.z;
        const along = Math.abs(dx * -wall.faceZ + dz * wall.faceX);
        const across = Math.abs(dx * wall.faceX + dz * wall.faceZ);
        return across < 1.5 && along < u.halfW + wall.halfW + 0.4;
      });
      if (overlaps) continue;
      // fascia height: above a door, below the first-floor windows / roofline
      const bh = tagHeight(wall.fp.meta?.tags);
      const y = bh ? Math.max(2.2, Math.min(3.4, bh - 0.9)) : 3.4;
      const sp = makeNameplateSprite(p.name, groundHeight, wall.x, wall.z, wall.faceX, wall.faceZ, { maxW: wall.halfW * 2, y });
      sp.visible = false;
      disposables.push({ dispose: () => sp.userData.dispose?.() });
      group.add(sp);
      signs.push(sp);
      continue;
    }
    // Fallback (POI not near any wall): free-standing plate. The plate is a PLANE
    // up to 14 m wide. placeOutsideBuilding only moves its centre clear, so clear both corners too.
    let placed = placeOutsideBuilding(p.x, p.z, insideBuilding, { roadPaths: drivable });
    if (insideBuilding) {
      const halfW = wantHalfW;
      const fx = placed.faceX ?? 0;
      const fz = placed.faceZ ?? 1;
      // tangent along the plate's width (perpendicular to its facing normal)
      const tx = -fz, tz = fx;
      const cornersClear = (cx, cz) =>
        !insideBuilding(cx + tx * halfW, cz + tz * halfW) &&
        !insideBuilding(cx - tx * halfW, cz - tz * halfW);
      if (!cornersClear(placed.x, placed.z)) {
        // step further along the facing normal until the whole plate is clear
        let ok = false;
        for (let step = 1; step <= 10; step++) {
          const nx = placed.x + fx * step * 1.5;
          const nz = placed.z + fz * step * 1.5;
          if (!insideBuilding(nx, nz) && cornersClear(nx, nz)) {
            placed = { ...placed, x: nx, z: nz, moved: true };
            ok = true;
            break;
          }
        }
        // still colliding (dense block, inner courtyard) → don't show a
        // nameplate embedded in geometry; skip it entirely.
        if (!ok) continue;
      }
    }
    const sp = makeNameplateSprite(
      p.name,
      groundHeight,
      placed.x,
      placed.z,
      placed.faceX ?? 0,
      placed.faceZ ?? 1
    );
    sp.visible = false;
    disposables.push({ dispose: () => sp.userData.dispose?.() });
    group.add(sp);
    signs.push(sp);
  }

  // ---- per-frame update ----
  const update = (dt, player, hour = 12, raining = false) => {
    terrainAge += dt;
    if (terrainAge > 0.25) {
      terrainAge = 0;
      terrainCache.clear();
    }
    const f = hourFactor(hour) * (raining ? 0.45 : 1);
    // rush hours: more cars on the road even when slower
    const rush =
      (hour >= 7 && hour < 10) || (hour >= 16 && hour < 20) ? 1.25 : 1;
    const pedActive = Math.round(pedBase * f);
    const carActive = Math.round(carBase * Math.max(0.25, f) * rush);
    pedTime += dt;
    signalClock += dt;
    if (pedWalkMaterials) setWalkPedTime(pedWalkMaterials, pedTime, raining ? 0.55 : 1);

    // nameplates: only show when close + in front-ish; depthTest hides through walls
    if (signs.length && player) {
      const px = player.x || 0;
      const pz = player.z || 0;
      for (const sp of signs) {
        const dx = (sp.userData.poiX ?? sp.position.x) - px;
        const dz = (sp.userData.poiZ ?? sp.position.z) - pz;
        const d2 = dx * dx + dz * dz;
        sp.visible = d2 < SIGN_SHOW_R * SIGN_SHOW_R;
        if (sp.visible) {
          // fade with distance so far plates don't dominate
          const d = Math.sqrt(d2);
          sp.material.opacity = Math.max(0.25, 1 - d / SIGN_SHOW_R);
        }
      }
    }

    if (peds) {
      // active peds are packed at the front; only those are drawn
      let n = 0;
      const lim = Math.min(PED_MAX, pedActive);
      for (let i = 0; i < lim; i++) {
        const p = pedList[i];
        if (!p?.w?.pts) continue;
        p.d += p.speed * p.dir * dt;
        if (p.d > p.w.L || p.d < 0) {
          if (random() < 0.4 && walkable.length) {
            p.w = walkable[(random() * walkable.length) | 0];
            p.d = random() < 0.5 ? 0 : p.w.L;
            p.dir = p.d === 0 ? 1 : -1;
            p.side = (random() < 0.5 ? -1 : 1) * (p.w.width / 2 + 0.6);
          } else {
            p.dir *= -1;
            p.d = Math.max(0, Math.min(p.w.L, p.d));
          }
        }
        const s = sampleAt(p.w.pts, p.w.cum, p.d);
        const px = s.x + -s.dz * p.side, pz = s.z + s.dx * p.side;
        p.phase += dt * p.speed * 5;
        dummy.position.set(px, terrainHeight(px, pz), pz);
        dummy.rotation.set(0, Math.atan2(s.dx * p.dir, s.dz * p.dir), 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        peds.setMatrixAt(i, dummy.matrix);
        n = i + 1;
      }
      peds.count = n;
      peds.instanceMatrix.needsUpdate = true;
    }

    if (cars) {
      // Active cars are the first carActive slots (instance colour is per slot,
      // so slots stay stable); a player-driven car beyond that extends the
      // range and the gap is parked. Nothing past carCount is drawn.
      const drivenSlot = drivenIndex >= 0 && drivenIndex < CAR_MAX ? drivenIndex : -1;
      const carCount = Math.min(CAR_MAX, Math.max(carActive, drivenSlot + 1));
      for (let i = 0; i < carCount; i++) {
        const ccar = carList[i];
        if (ccar.driven || i === drivenIndex) {
          // player-driven: matrix written via setDrivenPose
          continue;
        }
        if (i >= carActive || !ccar?.w?.pts) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
        } else {
          // tier-0: apply hour congestion to this road class
          const cong = congestionFactor(hour, ccar.w.hw) * (raining ? 0.7 : 1);
          let liveSpeed = (ccar.baseSpeed || ccar.speed) * cong;
          // 18.6: queue at red/amber when approaching a traffic signal
          if (signalList.length) {
            const hit = approachingCachedSignal(ccar.w, ccar.d, ccar.dir);
            if (hit) {
              const phase = signalPhase(signalClock, hit.sig.phaseOffset);
              if (phase === "red" || (phase === "amber" && hit.dist < 10)) {
                // stop ~4 m before the signal; creep if already past stop line
                if (hit.dist > 4) liveSpeed = Math.min(liveSpeed, Math.max(0, (hit.dist - 4) * 1.8));
                else liveSpeed = 0;
              }
            }
          }
          ccar.speed = liveSpeed;
          ccar.d += liveSpeed * ccar.dir * dt;
          if (ccar.d > ccar.w.L || ccar.d < 0) {
            // OSM splits streets at every junction (London median way: 45 m),
            // so teleporting at way-end made cars "despawn" right in front of
            // the player. Continue onto a CONNECTED way when one exists.
            const endIdx = ccar.dir > 0 ? ccar.w.pts.length - 1 : 0;
            const ex = ccar.w.pts[endIdx].x, ez = ccar.w.pts[endIdx].y;
            let nextW = null, nextDir = 1, nextD = 0;
            for (const w2 of drivable) {
              if (w2 === ccar.w) continue;
              const a = w2.pts[0], b2 = w2.pts[w2.pts.length - 1];
              if (Math.hypot(a.x - ex, a.y - ez) < 18) { nextW = w2; nextDir = 1; nextD = 0; break; }
              if (!w2.oneway && Math.hypot(b2.x - ex, b2.y - ez) < 18) { nextW = w2; nextDir = -1; nextD = w2.L; break; }
            }
            if (nextW) {
              ccar.w = nextW;
              ccar.dir = nextDir;
              ccar.d = nextD;
              ccar.baseSpeed = (CAR_SPEED[nextW.hw] || 8) * (0.85 + random() * 0.3);
              // keep smoothed heading/height — the join is physically continuous
            } else if (drivable.length) {
              // dead end: turn around on two-way roads, else respawn far from
              // the player so the jump is never visible
              if (!ccar.w.oneway) {
                ccar.dir *= -1;
                ccar.d = Math.max(0, Math.min(ccar.w.L, ccar.d));
              } else {
                let w2 = pickWeightedRoad(drivable, random);
                for (let tries = 0; tries < 6 && player; tries++) {
                  const mid = w2.pts[(w2.pts.length / 2) | 0];
                  if (Math.hypot(mid.x - (player.x || 0), mid.y - (player.z || 0)) > 120) break;
                  w2 = pickWeightedRoad(drivable, random);
                }
                ccar.w = w2;
                ccar.dir = w2.oneway ? 1 : random() < 0.5 ? 1 : -1;
                ccar.d = ccar.dir > 0 ? 0 : w2.L;
                ccar.baseSpeed = (CAR_SPEED[w2.hw] || 8) * (0.85 + random() * 0.3);
                ccar.h = null;
                ccar.y = null;
              }
            }
          }
          const s = sampleAt(ccar.w.pts, ccar.w.cum, ccar.d);
          const lane = (ccar.w.width / 4) * ccar.dir;
          const px = s.x + -s.dz * lane, pz = s.z + s.dx * lane;
          const targetH = Math.atan2(s.dx * ccar.dir, s.dz * ccar.dir);
          if (ccar.h === null) ccar.h = targetH;
          let dh = targetH - ccar.h;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          ccar.h += dh * Math.min(1, dt * 7);
          const ty = terrainHeight(px, pz) + 0.05;
          ccar.y = ccar.y === null ? ty : ccar.y + (ty - ccar.y) * Math.min(1, dt * 10);
          ccar.px = px;
          ccar.pz = pz;
          dummy.position.set(px, ccar.y, pz);
          dummy.rotation.set(0, ccar.h, 0);
          dummy.scale.setScalar(1);
        }
        dummy.updateMatrix();
        cars.setMatrixAt(i, dummy.matrix);
      }
      cars.count = carCount;
      cars.instanceMatrix.needsUpdate = true;
    }

    // birds circle a centre that slowly drifts around the player; none at night
    flock.t += dt;
    if (flock.t > 20 || (flock.x === 0 && flock.z === 0)) {
      flock.t = 0;
      flock.x = player.x + (random() - 0.5) * 160;
      flock.z = player.z + (random() - 0.5) * 160;
    }
    const night = hour < 6 || hour >= 20;
    if (night || raining) {
      birds.count = 0;
    } else {
      const flockY = terrainHeight(flock.x, flock.z);
      for (let i = 0; i < BIRD_MAX; i++) {
        const bd = birdList[i];
        bd.a += bd.va * dt;
        const bx = flock.x + Math.cos(bd.a) * bd.r;
        const bz = flock.z + Math.sin(bd.a) * bd.r;
        const by = flockY + bd.h + Math.sin(bd.a * 3 + bd.bob) * 2;
        dummy.position.set(bx, by, bz);
        dummy.rotation.set(0, -bd.a, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        birds.setMatrixAt(i, dummy.matrix);
      }
      birds.count = BIRD_MAX;
      birds.instanceMatrix.needsUpdate = true;
    }
  };

  const getNearestCar = (x, z, maxDist = 6.5) => {
    let best = null;
    let bestD = maxDist;
    for (let i = 0; i < carList.length; i++) {
      const c = carList[i];
      if (c.driven) continue;
      const px = c.px, pz = c.pz;
      if (px == null || pz == null) continue;
      const d = Math.hypot(px - x, pz - z);
      if (d < bestD) {
        bestD = d;
        best = {
          index: i,
          x: px,
          z: pz,
          y: c.y ?? terrainHeight(px, pz),
          heading: c.h ?? 0,
          speed: c.speed || 4,
        };
      }
    }
    return best;
  };

  const takeCar = (index) => {
    if (index < 0 || index >= carList.length) return false;
    carList[index].driven = true;
    drivenIndex = index;
    return true;
  };

  const releaseCar = (index, pose) => {
    if (index < 0 || index >= carList.length) return;
    const c = carList[index];
    c.driven = false;
    if (pose) {
      c.px = pose.x;
      c.pz = pose.z;
      // exit() returns walk heading (−Z); the mirror is its own inverse
      c.h = Math.PI - pose.heading;
      c.y = pose.y ?? terrainHeight(pose.x, pose.z);
      c.speed = Math.max(4, Math.abs(pose.speed || 4));
    }
    if (drivenIndex === index) drivenIndex = -1;
    // park: hide from AI path briefly by hopping to a new road next frame
    if (drivable.length && cars) {
      c.w = pickWeightedRoad(drivable, random);
      c.d = random() * c.w.L;
      c.dir = c.w.oneway ? 1 : random() < 0.5 ? 1 : -1;
      c.baseSpeed = (CAR_SPEED[c.w.hw] || 8) * (0.85 + random() * 0.3);
      c.speed = c.baseSpeed;
    }
  };

  const setDrivenPose = (index, pose) => {
    if (!cars || index < 0 || index >= carList.length || !pose) return;
    const c = carList[index];
    c.px = pose.x;
    c.pz = pose.z;
    // Vehicle heading is mesh-facing (+Z forward) — apply directly
    c.h = pose.heading;
    c.y = pose.y;
    dummy.position.set(pose.x, pose.y, pose.z);
    dummy.rotation.set(0, pose.heading, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    cars.setMatrixAt(index, dummy.matrix);
    cars.instanceMatrix.needsUpdate = true;
  };

  /** Rough check: is (x,z) within ~12 m of any drivable road sample? */
  // Coarse grid over the same road samples the linear scan used (built lazily).
  const NEAR_CELL = 32;
  let nearGrid = null;
  const nearKey = (cx, cz) => (cx + 65536) * 131072 + (cz + 65536);
  const buildNearGrid = () => {
    nearGrid = new Map();
    for (const w of drivable) {
      const step = Math.max(1, (w.pts.length / 8) | 0);
      for (let i = 0; i < w.pts.length; i += step) {
        const x = w.pts[i].x, z = w.pts[i].y;
        const key = nearKey(Math.floor(x / NEAR_CELL), Math.floor(z / NEAR_CELL));
        let cell = nearGrid.get(key);
        if (!cell) nearGrid.set(key, (cell = []));
        cell.push(x, z);
      }
    }
  };
  const nearDrivable = (x, z, maxD = 14) => {
    if (!nearGrid) buildNearGrid();
    const x0 = Math.floor((x - maxD) / NEAR_CELL), x1 = Math.floor((x + maxD) / NEAR_CELL);
    const z0 = Math.floor((z - maxD) / NEAR_CELL), z1 = Math.floor((z + maxD) / NEAR_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cell = nearGrid.get(nearKey(cx, cz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i += 2) {
          if (Math.hypot(cell[i] - x, cell[i + 1] - z) < maxD) return true;
        }
      }
    }
    return false;
  };

  const dispose = () => {
    scene.remove(group);
    for (const d of disposables) d.dispose?.();
  };

  /** Debug/QA: nameplate depth + distance gating (no always-on-top). */
  const getNameplateStats = (playerPos) => {
    const px = playerPos?.x ?? 0;
    const pz = playerPos?.z ?? 0;
    return signs.map((sp) => {
      const x = sp.userData.poiX ?? sp.position.x;
      const z = sp.userData.poiZ ?? sp.position.z;
      const dist = Math.hypot(x - px, z - pz);
      return {
        x,
        z,
        halfW: sp.userData.halfW ?? 0,
        mountX: Math.round(sp.position.x * 100) / 100,
        mountZ: Math.round(sp.position.z * 100) / 100,
        faceX: sp.userData.faceX ?? 0,
        faceZ: sp.userData.faceZ ?? 1,
        depthTest: sp.material?.depthTest === true,
        depthWrite: !!sp.material?.depthWrite,
        visible: !!sp.visible,
        opacity: sp.material?.opacity ?? 1,
        dist: Math.round(dist * 10) / 10,
        withinRange: dist < SIGN_SHOW_R,
      };
    });
  };

  return {
    update,
    dispose,
    getNearestCar,
    takeCar,
    releaseCar,
    setDrivenPose,
    nearDrivable,
    getNameplateStats,
    counts: { peds: pedBase, cars: carBase, birds: BIRD_MAX, signs: signs.length },
  };
}

export {
  CAR_SPEED,
  CAR_DENSITY,
  congestionFactor,
  pickWeightedRoad,
  makeNameplateSprite,
  hourFactor,
  SIGNAL_CYCLE,
  SIGNAL_STOP_R,
};
