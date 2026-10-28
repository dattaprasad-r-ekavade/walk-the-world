import { describe, expect, it } from 'vitest';
import {
  ALLOW_NEAR_TEXTURES_ON_MEDIUM_DESKTOP,
  menuPrefetchUrls,
  shouldPrefetchKtx2,
  shouldUseNearTextures,
} from '../lib/engine/ktx2-policy.js';

describe('ktx2 policy', () => {
  it('prefetches shared set and Basis decoder, not near set', () => {
    const urls = menuPrefetchUrls();
    expect(urls.length).toBe(4);
    expect(urls.some((u) => u.includes('facade-near'))).toBe(false);
    expect(urls.some((u) => u.endsWith('basis_transcoder.wasm'))).toBe(true);
  });
  it('respects Save-Data and slow coarse-pointer connections', () => {
    expect(shouldPrefetchKtx2({ saveData: true })).toBe(false);
    expect(shouldPrefetchKtx2({ coarsePointer: true, effectiveType: '3g' })).toBe(false);
    expect(shouldPrefetchKtx2({ coarsePointer: false, effectiveType: '3g' })).toBe(true);
    expect(shouldPrefetchKtx2({ coarsePointer: true, effectiveType: '4g' })).toBe(true);
  });
  it('gates near set by tier, platform and compressed support', () => {
    const wc = { dxtSupported: true };
    expect(shouldUseNearTextures({ quality: 'high' })).toBe(true);
    expect(shouldUseNearTextures({ quality: 'low', workerConfig: wc })).toBe(false);
    expect(shouldUseNearTextures({ quality: 'medium', isMobile: true, workerConfig: wc })).toBe(false);
    expect(shouldUseNearTextures({ quality: 'medium', workerConfig: {} })).toBe(false);
    expect(shouldUseNearTextures({ quality: 'medium', workerConfig: wc })).toBe(ALLOW_NEAR_TEXTURES_ON_MEDIUM_DESKTOP);
  });
});
