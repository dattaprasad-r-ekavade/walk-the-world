// M5 — real street lighting.
//
// We cannot afford a light per lamp post (a city cell has dozens, and every
// dynamic light multiplies shading cost on every lit fragment). Instead keep a
// small POOL of SpotLights and re-target them to whichever lamps are nearest
// the player, re-assigning only when the player has moved enough to change the
// answer. The far field keeps the cheap glow sprites + ground pools.
//
// This only pays off because M1 dropped asphalt roughness: the road can now
// actually show a specular pool under each lamp.
import * as THREE from "three";

const HEAD_Y = 4.25; // matches the lamp prop's bulb height
const WARM = 0xffd9a0; // ~2700K sodium/LED street lighting
const MAX_INTENSITY = 10;

/**
 * @param {THREE.Scene} scene
 * @param {{ maxLights?: number, radius?: number }} opts
 */
export function createStreetLights(scene, opts = {}) {
  const maxLights = Math.max(0, opts.maxLights ?? 8);
  const radius = opts.radius ?? 70; // only lamps within this range compete
  let keepInactiveVisible = opts.keepInactiveVisible !== false;
  const group = new THREE.Group();
  group.name = "streetLights";
  scene.add(group);

  const pool = [];
  for (let i = 0; i < maxLights; i++) {
    const l = new THREE.SpotLight(WARM, 0, 34, Math.PI / 3.1, 0.75, 1.4);
    l.castShadow = false; // shadow-casting per lamp is far too expensive
    // By default, keep inactive lights in the shader count to avoid a compile
    // on activation. Benchmarks can hide them to measure the steady-state cost.
    l.visible = keepInactiveVisible;
    l.userData.assigned = false;
    l.target.position.set(0, 0, 0);
    group.add(l);
    group.add(l.target);
    pool.push(l);
  }

  let lamps = [];
  let nightAmount = 0;
  let lastX = Infinity;
  let lastZ = Infinity;
  let groundHeight = () => 0;

  /** @param {Array<{x:number,z:number,kind?:string}>} propMarkers */
  const setLamps = (propMarkers, gh) => {
    lamps = (propMarkers || []).filter((p) => p.kind === "lamp");
    if (gh) groundHeight = gh;
    lastX = Infinity; // force a re-assign
  };

  /** 0 = day (lights off), 1 = full night */
  const setNight = (amount) => {
    nightAmount = Math.max(0, Math.min(1, amount));
    for (const l of pool) {
      l.intensity = l.userData.assigned ? nightAmount * MAX_INTENSITY : 0;
      l.visible = keepInactiveVisible || l.intensity > 0;
    }
    if (nightAmount <= 0.02) {
      for (const l of pool) {
        l.intensity = 0;
        l.userData.assigned = false;
        l.visible = keepInactiveVisible;
      }
      lastX = Infinity;
    }
  };

  const setKeepInactiveVisible = (visible) => {
    keepInactiveVisible = visible === true;
    for (const l of pool) l.visible = keepInactiveVisible || l.intensity > 0;
    return keepInactiveVisible;
  };

  /**
   * Re-target the pool at the nearest lamps. Cheap: only runs when the player
   * has moved >12 m, and only scans lamps (dozens), not the whole scene.
   */
  const update = (player) => {
    if (!pool.length || nightAmount <= 0.02) return;
    if (!lamps.length) {
      for (const l of pool) {
        l.intensity = 0;
        l.userData.assigned = false;
        l.visible = keepInactiveVisible;
      }
      return;
    }
    const px = player?.x ?? 0;
    const pz = player?.z ?? 0;
    if (Math.abs(px - lastX) < 12 && Math.abs(pz - lastZ) < 12) return;
    lastX = px;
    lastZ = pz;

    const near = [];
    for (const lamp of lamps) {
      const d = Math.hypot(lamp.x - px, lamp.z - pz);
      if (d < radius) near.push({ lamp, d });
    }
    near.sort((a, b) => a.d - b.d);

    for (let i = 0; i < pool.length; i++) {
      const l = pool[i];
      const hit = near[i];
      if (!hit) {
        l.intensity = 0;
        l.userData.assigned = false;
        l.visible = keepInactiveVisible;
        continue;
      }
      const { x, z } = hit.lamp;
      const gy = groundHeight(x, z);
      l.position.set(x, gy + HEAD_Y, z);
      l.target.position.set(x, gy, z); // straight down onto the road
      l.target.updateMatrixWorld();
      l.intensity = nightAmount * MAX_INTENSITY;
      l.visible = true;
      l.userData.assigned = true;
    }
  };

  const dispose = () => {
    scene.remove(group);
    for (const l of pool) l.dispose?.();
  };

  return {
    setLamps,
    setNight,
    setKeepInactiveVisible,
    update,
    dispose,
    get count() { return pool.length; },
    get keepInactiveVisible() { return keepInactiveVisible; },
  };
}
