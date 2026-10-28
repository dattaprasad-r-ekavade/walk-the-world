import { describe, expect, it } from 'vitest';
import { createRoofGeometry } from '../lib/engine/roof-geometry.js';

const rectangle = [[-8, -5], [8, -5], [8, 5], [-8, 5], [-8, -5]];

describe('building roof templates', () => {
  it.each(['gabled', 'hipped', 'skillion', 'pyramidal', 'dome'])('builds finite %s geometry above the cap', (shape) => {
    const geometry = createRoofGeometry(rectangle, 12, 3, shape);
    expect(geometry).toBeTruthy();
    const positions = geometry.attributes.position.array;
    const ys = [];
    for (let i = 1; i < positions.length; i += 3) ys.push(positions[i]);
    expect(ys.every(Number.isFinite)).toBe(true);
    expect(Math.min(...ys)).toBeCloseTo(12, 3);
    expect(Math.max(...ys)).toBeCloseTo(15, 3);
    expect(Array.from(geometry.attributes.normal.array).every(Number.isFinite)).toBe(true);
  });

  it('handles reversed, closed rings and unsupported shapes', () => {
    const reversed = [...rectangle].reverse();
    expect(createRoofGeometry(reversed, 0, 2, 'skillion')).toBeTruthy();
    expect(createRoofGeometry(rectangle, 0, 2, 'flat')).toBeNull();
  });
});
