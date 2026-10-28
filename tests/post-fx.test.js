import { describe, expect, it } from 'vitest';
import { getPostFxPassState } from '../lib/engine/post-fx.js';

describe('post-processing quality policy', () => {
  it('keeps both passes on for high quality at any time', () => {
    expect(getPostFxPassState('high', 0)).toEqual({ active: true, ssao: true });
    expect(getPostFxPassState('high', 1)).toEqual({ active: true, ssao: true });
  });

  it('enables bloom alone for medium night and disables it in daylight', () => {
    expect(getPostFxPassState('medium', 0.85)).toEqual({ active: true, ssao: false });
    expect(getPostFxPassState('medium', 0.15)).toEqual({ active: false, ssao: false });
  });

  it('keeps both passes off on low quality', () => {
    expect(getPostFxPassState('low', 1)).toEqual({ active: false, ssao: false });
  });
});
