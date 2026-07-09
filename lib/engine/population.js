// Populated world: instanced pedestrians walking the street graph, cars
// following road centerlines, boid-ish birds, and POI sign sprites.
// All data comes from the already-parsed city (roadPaths + POI nodes) —
// no extra network requests. Everything renders in a handful of draw calls:
// one InstancedMesh for peds, one for cars, one for birds.
import * as THREE from "three";
import { createWalkPedMaterial, setWalkPedTime } from "@/lib/engine/ped-walk";

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

function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

// position + direction at distance d along a polyline of Vector2 (x, .y=z)
function sampleAt(pts, cum, d) {
  if (!pts?.length || !cum?.length) return { x: 0, z: 0, dx: 0, dz: 1 };
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1] || pts[0];
  const b = pts[i] || pts[pts.length - 1] || a;
  if (!a || !b) return { x: 0, z: 0, dx: 0, dz: 1 };
  const seg = cum[i] - cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (d - (cum[i - 1] || 0)) / seg));
  const x = a.x + (b.x - a.x) * t;
  const z = a.y + (b.y - a.y) * t;
  const dx = (b.x - a.x) / seg, dz = (b.y - a.y) / seg;
  return { x, z, dx, dz };
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
export function createPopulation({ scene, groundHeight, roadPaths, pois = [], models = {} }) {
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

  const group = new THREE.Group();
  scene.add(group);
  const dummy = new THREE.Object3D();
  const disposables = [];

  // ---- density from POI count (busy commercial cells feel busy) ----
  const pedBase = Math.min(PED_MAX, Math.round(28 + pois.length * 1.4));
  const carBase = Math.min(CAR_MAX, Math.round(10 + drivable.length * 1.6));

  // ---- pedestrians ----
  let peds = null, pedList = [];
  let pedWalkMat = null;
  let pedTime = 0;
  if (walkable.length) {
    const geo = models.ped?.geometry || makePedGeometry();
    // Built-in peds use walk-cycle shader (15.1). Custom GLB keeps its material.
    pedWalkMat = models.ped?.material || createWalkPedMaterial(0xffffff);
    const mat = pedWalkMat;
    peds = new THREE.InstancedMesh(geo, mat, PED_MAX);
    peds.castShadow = true;
    peds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // per-instance walk phase for the vertex shader
    const phases = new Float32Array(PED_MAX);
    for (let i = 0; i < PED_MAX; i++) phases[i] = Math.random() * Math.PI * 2;
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
    disposables.push(geo, mat);
    for (let i = 0; i < PED_MAX; i++) {
      const w = walkable[(Math.random() * walkable.length) | 0];
      pedList.push({
        w,
        d: Math.random() * w.L,
        dir: Math.random() < 0.5 ? 1 : -1,
        speed: 1.1 + Math.random() * 0.7,
        side: (Math.random() < 0.5 ? -1 : 1) * (w.width / 2 + 0.6),
        phase: phases[i],
      });
      if (!models.ped) peds.setColorAt(i, new THREE.Color(PED_COLORS[i % PED_COLORS.length]));
    }
    if (peds.instanceColor) peds.instanceColor.needsUpdate = true;
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
      const w = drivable[(Math.random() * drivable.length) | 0];
      carList.push({
        w,
        d: Math.random() * w.L,
        dir: w.oneway ? 1 : Math.random() < 0.5 ? 1 : -1,
        speed: (CAR_SPEED[w.hw] || 8) * (0.85 + Math.random() * 0.3),
        h: null,
        y: null,
        px: 0,
        pz: 0,
        driven: false,
      });
      if (!models.car) cars.setColorAt(i, new THREE.Color(CAR_COLORS[i % CAR_COLORS.length]));
    }
    if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
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
      r: 14 + Math.random() * 30,
      a: Math.random() * Math.PI * 2,
      va: 0.25 + Math.random() * 0.3,
      h: 22 + Math.random() * 25,
      bob: Math.random() * Math.PI * 2,
    });
  const flock = { x: 0, z: 0, t: 0 };
  group.add(birds);

  // ---- POI sign sprites (nearest ~24 named shops/amenities) ----
  const signs = [];
  const named = pois.filter((p) => p.name).slice(0, 60);
  named.sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z));
  for (const p of named.slice(0, 24)) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 56;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(12,16,24,0.82)";
    g.beginPath();
    g.roundRect(0, 0, 256, 56, 12);
    g.fill();
    g.fillStyle = "#ffd97a";
    g.font = "bold 26px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const label = p.name.length > 18 ? p.name.slice(0, 17) + "…" : p.name;
    g.fillText(label, 128, 29);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(7, 1.55, 1);
    sp.position.set(p.x, groundHeight(p.x, p.z) + 4.2, p.z);
    disposables.push(tex, mat);
    group.add(sp);
    signs.push(sp);
  }

  // ---- per-frame update ----
  const update = (dt, player, hour = 12, raining = false) => {
    const f = hourFactor(hour) * (raining ? 0.45 : 1);
    const pedActive = Math.round(pedBase * f);
    const carActive = Math.round(carBase * Math.max(0.25, f));
    pedTime += dt;
    if (pedWalkMat && !models.ped) setWalkPedTime(pedWalkMat, pedTime, raining ? 0.55 : 1);

    if (peds) {
      for (let i = 0; i < PED_MAX; i++) {
        const p = pedList[i];
        if (i >= pedActive) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
        } else if (!p?.w?.pts) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
        } else {
          p.d += p.speed * p.dir * dt;
          if (p.d > p.w.L || p.d < 0) {
            if (Math.random() < 0.4 && walkable.length) {
              p.w = walkable[(Math.random() * walkable.length) | 0];
              p.d = Math.random() < 0.5 ? 0 : p.w.L;
              p.dir = p.d === 0 ? 1 : -1;
              p.side = (Math.random() < 0.5 ? -1 : 1) * (p.w.width / 2 + 0.6);
            } else {
              p.dir *= -1;
              p.d = Math.max(0, Math.min(p.w.L, p.d));
            }
          }
          const s = sampleAt(p.w.pts, p.w.cum, p.d);
          const px = s.x + -s.dz * p.side, pz = s.z + s.dx * p.side;
          p.phase += dt * p.speed * 5;
          dummy.position.set(px, groundHeight(px, pz), pz);
          dummy.rotation.set(0, Math.atan2(s.dx * p.dir, s.dz * p.dir), 0);
          dummy.scale.setScalar(1);
        }
        dummy.updateMatrix();
        peds.setMatrixAt(i, dummy.matrix);
      }
      peds.instanceMatrix.needsUpdate = true;
    }

    if (cars) {
      for (let i = 0; i < CAR_MAX; i++) {
        const ccar = carList[i];
        if (ccar.driven || i === drivenIndex) {
          // player-driven: matrix written via setDrivenPose
          continue;
        }
        if (i >= carActive) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
        } else if (!ccar?.w?.pts) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
        } else {
          ccar.d += ccar.speed * ccar.dir * dt;
          if (ccar.d > ccar.w.L || ccar.d < 0) {
            if (drivable.length) {
              ccar.w = drivable[(Math.random() * drivable.length) | 0];
              ccar.dir = ccar.w.oneway ? 1 : Math.random() < 0.5 ? 1 : -1;
              ccar.d = ccar.dir > 0 ? 0 : ccar.w.L;
              ccar.speed = (CAR_SPEED[ccar.w.hw] || 8) * (0.85 + Math.random() * 0.3);
              ccar.h = null;
              ccar.y = null;
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
          const ty = groundHeight(px, pz) + 0.05;
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
      cars.instanceMatrix.needsUpdate = true;
    }

    // birds circle a centre that slowly drifts around the player; none at night
    flock.t += dt;
    if (flock.t > 20 || (flock.x === 0 && flock.z === 0)) {
      flock.t = 0;
      flock.x = player.x + (Math.random() - 0.5) * 160;
      flock.z = player.z + (Math.random() - 0.5) * 160;
    }
    const night = hour < 6 || hour >= 20;
    for (let i = 0; i < BIRD_MAX; i++) {
      const bd = birdList[i];
      if (night || raining) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0.001);
      } else {
        bd.a += bd.va * dt;
        const bx = flock.x + Math.cos(bd.a) * bd.r;
        const bz = flock.z + Math.sin(bd.a) * bd.r;
        const by = groundHeight(flock.x, flock.z) + bd.h + Math.sin(bd.a * 3 + bd.bob) * 2;
        dummy.position.set(bx, by, bz);
        dummy.rotation.set(0, -bd.a, 0);
        dummy.scale.setScalar(1);
      }
      dummy.updateMatrix();
      birds.setMatrixAt(i, dummy.matrix);
    }
    birds.instanceMatrix.needsUpdate = true;
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
          y: c.y ?? groundHeight(px, pz),
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
      c.h = pose.heading;
      c.y = pose.y ?? groundHeight(pose.x, pose.z);
      c.speed = Math.max(4, Math.abs(pose.speed || 4));
    }
    if (drivenIndex === index) drivenIndex = -1;
    // park: hide from AI path briefly by hopping to a new road next frame
    if (drivable.length && cars) {
      c.w = drivable[(Math.random() * drivable.length) | 0];
      c.d = Math.random() * c.w.L;
      c.dir = c.w.oneway ? 1 : Math.random() < 0.5 ? 1 : -1;
    }
  };

  const setDrivenPose = (index, pose) => {
    if (!cars || index < 0 || index >= carList.length || !pose) return;
    const c = carList[index];
    c.px = pose.x;
    c.pz = pose.z;
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
  const nearDrivable = (x, z, maxD = 14) => {
    for (const w of drivable) {
      for (let i = 0; i < w.pts.length; i += Math.max(1, (w.pts.length / 8) | 0)) {
        if (Math.hypot(w.pts[i].x - x, w.pts[i].y - z) < maxD) return true;
      }
    }
    return false;
  };

  const dispose = () => {
    scene.remove(group);
    for (const d of disposables) d.dispose?.();
  };

  return {
    update,
    dispose,
    getNearestCar,
    takeCar,
    releaseCar,
    setDrivenPose,
    nearDrivable,
    counts: { peds: pedBase, cars: carBase, birds: BIRD_MAX, signs: signs.length },
  };
}
