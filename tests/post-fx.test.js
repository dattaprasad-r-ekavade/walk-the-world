import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { createPostFx, getPostFxPassState } from '../lib/engine/post-fx.js';

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

it('releases every owned post-processing pass and the SSAO resources omitted by Three.js', () => {
  const ssaoDispose = vi.spyOn(SSAOPass.prototype, 'dispose');
  const bloomDispose = vi.spyOn(UnrealBloomPass.prototype, 'dispose');
  const outputDispose = vi.spyOn(OutputPass.prototype, 'dispose');
  const composerDispose = vi.spyOn(EffectComposer.prototype, 'dispose');
  const materialDispose = vi.spyOn(THREE.ShaderMaterial.prototype, 'dispose');
  const textureDispose = vi.spyOn(THREE.DataTexture.prototype, 'dispose');
  try {
    const renderer = { getSize: (size) => size.set(320, 180), getPixelRatio: () => 1 };
    const fx = createPostFx(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
    fx.setEnabled(true, true);
    fx.dispose();
    fx.dispose();
    const ssao = ssaoDispose.mock.contexts[0];
    expect(ssaoDispose).toHaveBeenCalledOnce();
    expect(bloomDispose).toHaveBeenCalledOnce();
    expect(outputDispose).toHaveBeenCalledOnce();
    expect(composerDispose).toHaveBeenCalledOnce();
    expect(materialDispose.mock.contexts.filter((material) => material === ssao.ssaoMaterial)).toHaveLength(1);
    expect(textureDispose.mock.contexts.filter((texture) => texture === ssao.noiseTexture)).toHaveLength(1);
  } finally {
    vi.restoreAllMocks();
  }
});
