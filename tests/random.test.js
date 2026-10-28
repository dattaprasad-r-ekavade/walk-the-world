import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../lib/engine/random.js';

describe('seeded procedural texture random', () => {
  it('repeats the same sequence for the same texture key', () => {
    const first = createSeededRandom('asphalt:v1');
    const second = createSeededRandom('asphalt:v1');

    expect(Array.from({ length: 12 }, first)).toEqual(
      Array.from({ length: 12 }, second)
    );
  });

  it('uses separate sequences for different texture keys', () => {
    const first = createSeededRandom('asphalt:v1');
    const second = createSeededRandom('plaster:v1');

    expect(Array.from({ length: 8 }, first)).not.toEqual(
      Array.from({ length: 8 }, second)
    );
  });
});
