// @ts-check
import * as THREE from "three";

/** Rain or snow particles in an 80 m box that follows the player. */
export function createPrecipitation(scene, random = Math.random) {
  let current = null;
  let tick = 0;

  const clear = () => {
    if (!current) return;
    scene.remove(current.points);
    current.geometry.dispose();
    current.points.material.dispose();
    current = null;
  };

  /** @param {"rain" | "snow" | null} mode */
  const set = (mode) => {
    clear();
    if (!mode) return;
    const count = mode === "rain" ? 1600 : 900;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - 0.5) * 80;
      positions[i * 3 + 1] = random() * 40;
      positions[i * 3 + 2] = (random() - 0.5) * 80;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: mode === "rain" ? 0x9fb8d8 : 0xffffff,
      size: mode === "rain" ? 0.14 : 0.32,
      transparent: true,
      opacity: 0.75,
    }));
    scene.add(points);
    current = { points, geometry, speed: mode === "rain" ? 28 : 4 };
  };

  /** Advances the particles every other frame (at double step). */
  const update = (dt, x, y, z) => {
    if (!current || ++tick % 2 !== 0) return;
    const attr = current.geometry.attributes.position;
    for (let i = 0; i < attr.count; i++) {
      let py = attr.getY(i) - current.speed * dt * 2;
      if (py < 0) py = 40;
      attr.setY(i, py);
    }
    attr.needsUpdate = true;
    current.points.position.set(x, y, z);
  };

  return {
    set,
    update,
    get active() { return current !== null; },
    dispose: clear,
  };
}
