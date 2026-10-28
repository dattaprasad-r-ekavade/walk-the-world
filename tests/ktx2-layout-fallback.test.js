import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ textures: [], parses: [] }));
vi.mock('three/examples/jsm/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    setTranscoderPath() { return this; }
    setWorkerLimit() { return this; }
    detectSupport() { return this; }
    init() { return Promise.resolve(); }
    dispose() {}
    parse(buffer, resolve) {
      const high = new Uint8Array(buffer)[0] === 1;
      mocks.parses.push(high);
      const texture = { image: { width: high ? 1600 : 512, height: high ? 2096 : 1024 },
        repeat: {}, offset: {}, mipmaps: [{ data: new Uint8Array(1) }], dispose: vi.fn() };
      mocks.textures.push({ high, texture });
      resolve(texture);
    }
  },
}));
import { createKtx2BuildingTextureLoader, parseFacadeLayout } from '../lib/engine/ktx2-textures.js';

const validLayout = readFileSync('public/textures/ktx2/facade-near-layout.10de0c1cfef7cbc0.json', 'utf8');
const renderer = { capabilities: { getMaxAnisotropy: () => 8 } };
beforeEach(() => { mocks.textures.length = 0; mocks.parses.length = 0; });
afterEach(() => vi.unstubAllGlobals());

function stubFetch(layout) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('facade-near-layout')) return { ok: true, text: async () => layout };
    const high = String(url).includes('facade-near-');
    return { ok: true, arrayBuffer: async () => new Uint8Array([high ? 1 : 0]).buffer };
  }));
}

describe('high atlas layout fallback', () => {
  it('accepts the shipped layout and rejects malformed or out-of-bounds rectangles', () => {
    expect(parseFacadeLayout(validLayout).Plaster004).toBeDefined();
    expect(() => parseFacadeLayout('{')).toThrow();
    const invalid = JSON.parse(validLayout);
    invalid.materialRects.Bricks060.uvRectBottomLeft = [0.9, 0, 0.2, 0.5];
    expect(() => parseFacadeLayout(JSON.stringify(invalid))).toThrow(/Bricks060/);
    delete invalid.materialRects.Bricks060;
    expect(() => parseFacadeLayout(JSON.stringify(invalid))).toThrow(/Bricks060/);
  });

  it('keeps shared maps and avoids high-tier transcodes when layout JSON is invalid', async () => {
    stubFetch('{');
    const onError = vi.fn(), onSharedReady = vi.fn(), onHighReady = vi.fn();
    const loader = createKtx2BuildingTextureLoader(renderer, { onError, onSharedReady, onHighReady });
    loader.setQuality('high');
    loader.setWalkingReady();
    expect((await loader.promise).tier).toBe('shared');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError.mock.calls[0][1]).toBe('high');
    expect(onSharedReady).toHaveBeenCalledOnce();
    expect(onHighReady).not.toHaveBeenCalled();
    expect(mocks.parses.filter(Boolean)).toHaveLength(0);
    loader.dispose();
  });

  it('disposes every high texture once if installation fails after decoding', async () => {
    stubFetch(validLayout);
    const onError = vi.fn();
    const loader = createKtx2BuildingTextureLoader(renderer, {
      onError, onHighReady: () => { throw new Error('installation failed'); },
    });
    loader.setQuality('high');
    loader.setWalkingReady();
    await loader.promise;
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    const high = mocks.textures.filter((entry) => entry.high);
    expect(high).toHaveLength(4);
    for (const { texture } of high) expect(texture.dispose).toHaveBeenCalledOnce();
    loader.dispose();
  });
});
