import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('road material weather inheritance', () => {
  it('creates newly streamed road materials with current wetness', async () => {
    const context = { fillRect() {} };
    vi.stubGlobal('document', {
      createElement: (name) => {
        if (name !== 'canvas') throw new Error(`Unexpected element: ${name}`);
        return { width: 0, height: 0, getContext: () => context };
      },
    });

    const { getRoadMaterial, roadMaterialCount, setRoadWetness } = await import('../lib/engine/materials.js');
    const initialCount = roadMaterialCount();
    setRoadWetness(0.8);
    const material = getRoadMaterial(0x3a7b2d, 'plain', 'service');

    expect(material.roughness).toBeCloseTo(0.296);
    expect(material.normalScale.x).toBeCloseTo(0.23);
    expect(material.envMapIntensity).toBeCloseTo(2.47);
    const wetColor = material.color.clone();

    setRoadWetness(0);
    expect(material.roughness).toBe(1);
    expect(material.envMapIntensity).toBe(0.55);
    expect(wetColor.r).toBeCloseTo(material.color.r * 0.888);
    expect(wetColor.g).toBeCloseTo(material.color.g * 0.888);
    expect(wetColor.b).toBeCloseTo(material.color.b * 0.888);
    material.dispose();
    expect(roadMaterialCount()).toBe(initialCount);
  });
});
