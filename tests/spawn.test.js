import { describe, it, expect } from 'vitest';
import { inRing, createHitTest, viewScore, pickSpawn, pickSpawnAsync, pickHeading, pickHeadingAsync } from '../lib/engine/street/spawn.js';

/** Axis-aligned box ring in the engine's `[[x, z], ...]` format. */
const box = (cx, cz, w, d) => [
  [cx - w / 2, cz - d / 2],
  [cx + w / 2, cz - d / 2],
  [cx + w / 2, cz + d / 2],
  [cx - w / 2, cz + d / 2],
];

/**
 * A street canyon running along -Z (the engine's heading-0 direction), with
 * building blocks down both sides, and open ground behind the player at +Z.
 */
function canyon() {
  const buildings = [];
  for (let i = 1; i <= 6; i++) {
    buildings.push(box(-14, -i * 22, 16, 18)); // west side
    buildings.push(box(14, -i * 22, 16, 18));  // east side
  }
  const roadPoints = [];
  for (let i = 0; i <= 8; i++) {
    const z = -i * 16;
    roadPoints.push({ x: 0, z, nx: 0, nz: z - 16, cls: 'residential', width: 7 });
  }
  return { buildings, roadPoints };
}

describe('engine/street/spawn', () => {
  it('point-in-polygon handles inside, outside and beyond-bbox', () => {
    const b = box(0, 0, 10, 10);
    expect(inRing(0, 0, b)).toBe(true);
    expect(inRing(4.9, 4.9, b)).toBe(true);
    expect(inRing(6, 0, b)).toBe(false);
    expect(inRing(0, 99, b)).toBe(false);
  });

  it('hit test agrees with a direct ring test across the grid', () => {
    const rings = [box(0, 0, 10, 10), box(200, -300, 20, 8)];
    const hit = createHitTest(rings);
    expect(hit(0, 0)).toBe(true);
    expect(hit(200, -300)).toBe(true);   // far cell, negative coords
    expect(hit(100, 100)).toBe(false);
    expect(hit(20, 0)).toBe(false);
  });

  it('scores a street canyon higher than open ground', () => {
    const { buildings } = canyon();
    const hit = createHitTest(buildings);
    const down = viewScore({ x: 0, z: 0, heading: 0 }, hit);        // into the canyon
    const away = viewScore({ x: 0, z: 0, heading: Math.PI }, hit);  // out at nothing
    expect(down.coverage).toBeGreaterThan(0.5);
    expect(away.coverage).toBe(0);
    expect(down.score).toBeGreaterThan(away.score);
  });

  it('penalises facing a wall even when coverage is total', () => {
    // Player pressed up against a single large slab: every ray hits, but the
    // view is blocked, so the score must not read as a good frame.
    const hit = createHitTest([box(0, -12, 200, 8)]);
    const v = viewScore({ x: 0, z: 0, heading: 0 }, hit);
    expect(v.coverage).toBeGreaterThan(0.9);
    expect(v.openness).toBeLessThan(0.5);
    expect(v.score).toBeLessThan(0.5);
  });

  it('faces down the street regardless of OSM way direction', () => {
    const geo = canyon();
    const spawn = pickSpawn(geo);
    expect(spawn).toBeTruthy();
    // heading 0 = -Z = into the canyon. Away would be ±PI.
    expect(Math.abs(spawn.heading)).toBeLessThan(0.4);
    expect(spawn.score).toBeGreaterThan(0.5);
  });

  it('yields during spawn framing without changing the selected pose', async () => {
    const geo = canyon();
    const checkpoints = [];
    const expected = pickSpawn(geo);
    const actual = await pickSpawnAsync(geo, {
      checkpoint: (stage) => {
        checkpoints.push(stage);
        return Promise.resolve();
      },
    });
    expect(actual).toEqual(expected);
    expect(checkpoints).toContain('spawn-view-rays');
  });

  it('picks the same frame when the way is digitised backwards', () => {
    const geo = canyon();
    const reversed = {
      buildings: geo.buildings,
      roadPoints: geo.roadPoints.map((p) => ({ ...p, nx: p.x, nz: p.z + 16, x: p.x, z: p.z })),
    };
    const a = pickSpawn(geo);
    const b = pickSpawn(reversed);
    // Way direction flipped; the chosen heading must not flip with it.
    expect(Math.abs(a.heading - b.heading)).toBeLessThan(0.4);
  });

  it('never spawns inside a building', () => {
    const geo = canyon();
    const hit = createHitTest(geo.buildings);
    const spawn = pickSpawn(geo);
    expect(hit(spawn.x, spawn.z)).toBe(false);
  });

  it('respects the move budget', () => {
    const geo = canyon();
    const spawn = pickSpawn(geo, { maxMove: 20 });
    expect(Math.hypot(spawn.x, spawn.z)).toBeLessThanOrEqual(20);
  });

  it('returns null when there are no roads to stand on', () => {
    expect(pickSpawn({ buildings: [box(0, 0, 10, 10)], roadPoints: [] })).toBeNull();
    expect(pickSpawn({ buildings: [], roadPoints: [] })).toBeNull();
  });

  it('pickHeading turns to face the city without moving the player', () => {
    const { buildings } = canyon();
    const hit = createHitTest(buildings);
    const h = pickHeading(0, 0, hit);
    // The canyon runs toward -Z, i.e. heading 0. pickHeading sweeps 0..2PI, so
    // accept either end of the wrap.
    const off = Math.min(Math.abs(h.heading), Math.abs(h.heading - Math.PI * 2));
    expect(off).toBeLessThan(0.5);
    expect(h.score).toBeGreaterThan(0.5);
  });

  it('yields during heading selection and matches the synchronous result', async () => {
    const hit = createHitTest(canyon().buildings);
    const expected = pickHeading(0, 0, hit);
    const actual = await pickHeadingAsync(0, 0, hit, {
      checkpoint: () => Promise.resolve(),
    });
    expect(actual).toEqual(expected);
  });

  it('still returns a pose when the cell has no buildings at all', () => {
    // Broken/park cells must not crash the spawn path — the engine falls back
    // to legacy behaviour only when this returns null.
    const spawn = pickSpawn({ buildings: [], roadPoints: canyon().roadPoints });
    expect(spawn).toBeTruthy();
    expect(spawn.score).toBe(0);
  });
});
