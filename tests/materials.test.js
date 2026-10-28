import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('road material weather inheritance', () => {
  it('binds replacement environment maps to existing and newly created roads', async () => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }) }) });
    const { getRoadMaterial, setRoadEnvironment, sharedMaterialTextures } = await import('../lib/engine/materials.js');
    const first = new THREE.Texture(), replacement = new THREE.Texture();
    const existing = getRoadMaterial(0x123456, true);
    setRoadEnvironment(first);
    const streamed = getRoadMaterial(0x345678, true);
    expect(existing.envMap).toBe(first);
    expect(streamed.envMap).toBe(first);
    expect(sharedMaterialTextures()).toContain(first);
    setRoadEnvironment(replacement);
    expect(existing.envMap).toBe(replacement);
    expect(streamed.envMap).toBe(replacement);
    expect(sharedMaterialTextures()).toContain(replacement);
    expect(sharedMaterialTextures()).not.toContain(first);
    setRoadEnvironment(null);
    expect(existing.envMap).toBeNull();
    existing.dispose();
    streamed.dispose();
  });
  it('creates newly streamed road materials with current wetness', async () => {
    const context = { fillRect() {} };
    vi.stubGlobal('document', {
      createElement: (name) => {
        if (name !== 'canvas') throw new Error(`Unexpected element: ${name}`);
        return { width: 0, height: 0, getContext: () => context };
      },
    });

    const { getRoadMaterial, roadMaterialCount, setRoadWetness, setWetRoadMapCandidate } = await import('../lib/engine/materials.js');
    const initialCount = roadMaterialCount();
    setRoadWetness(0.8);
    const material = getRoadMaterial(0x3a7b2d, 'plain', 'service');
    const dryRoughnessMap = material.roughnessMap;
    expect(setWetRoadMapCandidate(true).candidateCount).toBeGreaterThan(0);
    const wetRoughnessMap = material.roughnessMap;
    expect(wetRoughnessMap).not.toBe(dryRoughnessMap);

    expect(material.roughness).toBeCloseTo(0.296);
    expect(material.normalScale.x).toBeCloseTo(0.23);
    expect(material.envMapIntensity).toBeCloseTo(2.47);
    expect(wetRoughnessMap).toBeTruthy();
    const wetColor = material.color.clone();

    setRoadWetness(0);
    expect(material.roughness).toBe(1);
    expect(material.roughnessMap).not.toBe(wetRoughnessMap);
    setWetRoadMapCandidate(false);
    expect(material.envMapIntensity).toBe(0.55);
    expect(wetColor.r).toBeCloseTo(material.color.r * 0.888);
    expect(wetColor.g).toBeCloseTo(material.color.g * 0.888);
    expect(wetColor.b).toBeCloseTo(material.color.b * 0.888);
    material.dispose();
    expect(roadMaterialCount()).toBe(initialCount);
  });
});
