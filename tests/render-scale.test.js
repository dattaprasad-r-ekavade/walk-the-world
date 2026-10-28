import { describe, expect, it } from 'vitest';
import { createRenderScaleState, isAtRenderScaleFloor, p90Of, renderScaleTargetMs, stepRenderScale } from '../lib/engine/render-scale.js';

const T = 16.7;
const run = (state, values, target = T) => values.reduce((s, v) => stepRenderScale(s, v, target), state);

describe('render scale governor', () => {
  it('needs two consecutive slow windows before reducing by 10%', () => {
    let s = stepRenderScale(createRenderScaleState(), 25, T);
    expect(s.scale).toBe(1);
    s = stepRenderScale(s, 25, T);
    expect(s.scale).toBe(0.9);
  });

  it('a single slow window followed by a good one does not reduce', () => {
    const s = run(createRenderScaleState(), [25, 15, 25, 15]);
    expect(s.scale).toBe(1);
  });

  it('clamps at the 0.6 floor', () => {
    const s = run(createRenderScaleState(), Array(40).fill(30));
    expect(s.scale).toBe(0.6);
    expect(isAtRenderScaleFloor(s.scale)).toBe(true);
  });

  it('raises 5% after four comfortable windows, capped at 1', () => {
    let s = run(createRenderScaleState(0.8), [10, 10, 10]);
    expect(s.scale).toBe(0.8);
    s = stepRenderScale(s, 10, T);
    expect(s.scale).toBe(0.85);
    s = run(s, Array(40).fill(10));
    expect(s.scale).toBe(1);
  });

  it('dead band between 0.75x and 1x target resets counters (no oscillation)', () => {
    const s = run(createRenderScaleState(0.8), [10, 10, 10, 15, 10, 10, 10]);
    expect(s.scale).toBe(0.8);
  });

  it('uses the relaxed 30 fps target for low quality', () => {
    expect(renderScaleTargetMs('low')).toBeCloseTo(33.3, 1);
    expect(renderScaleTargetMs('high')).toBeCloseTo(16.7, 1);
  });

  it('ignores invalid samples and does not mutate input', () => {
    const s0 = createRenderScaleState();
    expect(stepRenderScale(s0, NaN, T)).toEqual(s0);
    stepRenderScale(s0, 99, T);
    expect(s0).toEqual({ scale: 1, over: 0, under: 0 });
  });

  it('computes p90', () => {
    const a = new Float32Array(10).map((_, i) => i + 1);
    expect(p90Of(a, 10)).toBe(9);
  });
});
