import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createStreetLights } from '../lib/engine/street-lights.js';

describe('pooled street lights', () => {
  it('keeps a bounded pool and assigns the nearest lamps inside its radius', () => {
    const scene = new THREE.Scene();
    const lights = createStreetLights(scene, { maxLights: 2, radius: 40 });
    const pool = scene.getObjectByName('streetLights').children.filter((child) => child.isSpotLight);

    lights.setLamps([
      { kind: 'lamp', x: 20, z: 0 },
      { kind: 'lamp', x: 10, z: 0 },
      { kind: 'lamp', x: 80, z: 0 },
    ], () => 2);
    lights.setNight(0.5);
    lights.update({ x: 0, z: 0 });

    expect(pool).toHaveLength(2);
    expect(pool.map((light) => light.position.x)).toEqual([10, 20]);
    expect(pool.every((light) => light.userData.assigned)).toBe(true);
    expect(pool.every((light) => light.intensity === 5)).toBe(true);
    expect(pool.every((light) => light.position.y === 6.25)).toBe(true);
    lights.dispose();
  });

  it('reassigns streamed lamps, clears evicted lamps, and restores the pool after lights turn off', () => {
    const scene = new THREE.Scene();
    const lights = createStreetLights(scene, { maxLights: 2, radius: 40 });
    const pool = scene.getObjectByName('streetLights').children.filter((child) => child.isSpotLight);

    lights.setLamps([{ kind: 'lamp', x: 0, z: 0 }]);
    lights.setNight(1);
    lights.update({ x: 0, z: 0 });
    expect(pool[0].intensity).toBe(10);

    lights.setNight(0);
    expect(pool.every((light) => light.intensity === 0 && !light.userData.assigned)).toBe(true);
    lights.setNight(1);
    lights.update({ x: 0, z: 0 });
    expect(pool[0].intensity).toBe(10);

    lights.setLamps([{ kind: 'lamp', x: 12, z: 0 }]);
    lights.update({ x: 12, z: 0 });
    expect(pool[0].position.x).toBe(12);

    lights.setLamps([]);
    lights.update({ x: 12, z: 0 });
    expect(pool.every((light) => light.intensity === 0 && !light.userData.assigned)).toBe(true);
    lights.dispose();
  });
});
