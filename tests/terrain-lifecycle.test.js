import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@/lib/engine/ground-tiles', () => ({
  drawGroundTileImage: vi.fn(),
  groundTileUrl: vi.fn((_source, _z, x, y) => `https://tiles.test/${x}/${y}`),
}));

import { drawGroundTileImage } from '@/lib/engine/ground-tiles';
import { createTerrainSystem } from '@/lib/engine/street/terrain';

const imageInstances = [];

class PendingImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this.crossOrigin = null;
    this._src = '';
  }

  set src(value) {
    this._src = value;
    if (value) imageInstances.push(this);
  }

  get src() { return this._src; }
}

function resolveImage(index) {
  const image = imageInstances[index];
  expect(image?.onload).toBeTypeOf('function');
  image.onload();
}

function flushImages() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('terrain tile lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    imageInstances.length = 0;
  });

  it('evicts terrain resources, ignores late imagery, and reloads a revisited tile', async () => {
    vi.stubGlobal('Image', PendingImage);
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = { width: 0, height: 0 };
        const context = {
          canvas,
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(256 * 256 * 4) })),
          putImageData: vi.fn(),
          fillRect: vi.fn(),
        };
        canvas.getContext = () => context;
        return canvas;
      },
    });

    const scene = new THREE.Scene();
    const signal = new AbortController().signal;
    const terrain = createTerrainSystem({
      scene,
      lat0: 0,
      lon0: 0,
      toLocal: (lat, lon) => ({ x: lon, z: lat }),
      groundSource: 'osm',
      signal,
      onStage: vi.fn(),
      onProgress: vi.fn(),
    });

    const firstLoad = terrain.loadTile(100, 100, true);
    await vi.waitFor(() => expect(imageInstances).toHaveLength(1));
    resolveImage(0);
    await firstLoad;
    expect(terrain.terrainTiles.has('100/100')).toBe(true);
    expect(scene.children).toHaveLength(2); // terrain and its seam skirt
    expect(terrain.tileCanvases).toHaveLength(1);
    expect(imageInstances).toHaveLength(5); // elevation plus four imagery subtiles

    const oldEntry = terrain.tileCanvases[0];
    const oldTextureVersion = oldEntry.texture.version;
    const oldTextureDispose = vi.spyOn(oldEntry.texture, 'dispose');
    terrain.evictFar(103, 100, 2);
    expect(terrain.terrainTiles.has('100/100')).toBe(false);
    expect(terrain.tileCanvases).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
    expect(oldEntry.disposed).toBe(true);
    expect(oldEntry.g.canvas.width).toBe(1);
    expect(oldTextureDispose).toHaveBeenCalledOnce();

    for (let index = 1; index <= 4; index++) resolveImage(index);
    await flushImages();
    expect(drawGroundTileImage).not.toHaveBeenCalled();
    expect(oldEntry.texture.version).toBe(oldTextureVersion);

    const revisit = terrain.loadTile(100, 100, true);
    await vi.waitFor(() => expect(imageInstances).toHaveLength(6));
    resolveImage(5);
    await revisit;
    expect(terrain.terrainTiles.has('100/100')).toBe(true);
    expect(scene.children).toHaveLength(2);
    expect(terrain.tileCanvases).toHaveLength(1);
    expect(terrain.tileCanvases[0]).not.toBe(oldEntry);

    for (let index = 6; index <= 9; index++) resolveImage(index);
    await flushImages();
    expect(drawGroundTileImage).toHaveBeenCalledTimes(4);
    expect(terrain.tileCanvases[0].texture.version).toBeGreaterThan(oldTextureVersion);
    terrain.dispose();
  });
});
