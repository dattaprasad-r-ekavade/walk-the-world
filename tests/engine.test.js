import { describe, it, expect } from 'vitest';
import { lon2tx, lat2ty, tx2lon, ty2lat, makeLocalFrame } from '../lib/engine/geo.js';

describe('engine/geo', () => {
  it('converts slippy tile coordinates', () => {
    const z = 14;
    const lat = 41.8902;
    const lon = 12.4922;
    const tx = lon2tx(lon, z);
    const ty = lat2ty(lat, z);
    expect(tx).toBeGreaterThan(0);
    expect(ty).toBeGreaterThan(0);
    expect(tx2lon(Math.floor(tx), z)).toBeLessThan(lon + 1);
    expect(ty2lat(Math.floor(ty), z)).toBeLessThan(lat + 1);
  });

  it('builds a local ENU frame', () => {
    const { toLocal, toGeo } = makeLocalFrame(41.89, 12.49);
    const local = toLocal(41.89, 12.49);
    expect(Math.abs(local.x)).toBeLessThan(1);
    expect(Math.abs(local.z)).toBeLessThan(1);
    const back = toGeo(local.x, local.z);
    expect(Math.abs(back.lat - 41.89)).toBeLessThan(0.001);
    expect(Math.abs(back.lon - 12.49)).toBeLessThan(0.001);
  });
});

describe('street/collision', () => {
  it('detects point inside footprint', async () => {
    const { createCollision } = await import('../lib/engine/street/collision.js');
    const { addFootprint, insideBuilding } = createCollision(60);
    addFootprint([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(insideBuilding(5, 5)).toBe(true);
    expect(insideBuilding(50, 50)).toBe(false);
  });
});

describe('street/ground-height', () => {
  it('samples bilinear height from terrain tiles', async () => {
    const { createGroundHeight } = await import('../lib/engine/street/ground-height.js');
    const tiles = new Map();
    const N = 3;
    tiles.set('0/0', {
      heights: new Float32Array([0, 10, 20, 30, 40, 50, 60, 70, 80]),
      n: N,
      x0: 0,
      z0: 0,
      sizeX: 100,
      sizeZ: 100,
    });
    const groundHeight = createGroundHeight(tiles);
    expect(groundHeight(50, 50)).toBeGreaterThan(0);
    expect(groundHeight(50, 50)).toBe(groundHeight(50, 50));
  });
});
