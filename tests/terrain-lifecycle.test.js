import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@/lib/engine/ground-tiles', () => ({
  drawGroundTileImage: vi.fn(),
  groundTileUrl: vi.fn((_source, _z, x, y) => `https://tiles.test/${x}/${y}`),
}));

import { drawGroundTileImage } from '@/lib/engine/ground-tiles';
import { createTerrainSystem } from '@/lib/engine/street/terrain';
import { prefetchSpawnTerrain, spawnTerrainTileKey, takeSpawnTerrainPrefetch } from '@/lib/engine/street/terrain-prefetch';

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

    const firstLoad = terrain.ensureTiles(['100/100']);
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

  it('loads height grids without visuals and upgrades them without refetching elevation', async () => {
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
    const terrain = createTerrainSystem({
      scene,
      lat0: 0,
      lon0: 0,
      toLocal: (lat, lon) => ({ x: lon, z: lat }),
      groundSource: 'osm',
      signal: new AbortController().signal,
      onStage: vi.fn(),
      onProgress: vi.fn(),
    });

    const validationLoad = terrain.ensureHeightTiles(['100/100']);
    await vi.waitFor(() => expect(imageInstances).toHaveLength(1));
    resolveImage(0);
    await expect(validationLoad).resolves.toBe(true);
    expect(terrain.terrainTiles.has('100/100')).toBe(true);
    expect(scene.children).toHaveLength(0);
    expect(terrain.tileCanvases).toHaveLength(0);

    const visualLoad = terrain.loadTile(100, 100, true);
    await vi.waitFor(() => expect(imageInstances).toHaveLength(5));
    expect(imageInstances[0]._src).toContain('/terrarium/');
    for (let index = 1; index <= 4; index++) resolveImage(index);
    await visualLoad;
    await flushImages();

    expect(imageInstances).toHaveLength(5);
    expect(scene.children).toHaveLength(2);
    expect(terrain.tileCanvases).toHaveLength(1);
    terrain.dispose();
  });
  it('reuses the street page spawn-tile request once, then asks the network again', async () => {
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
    const lat0 = 40.758;
    const lon0 = -73.9855;
    const key = spawnTerrainTileKey(lat0, lon0);

    prefetchSpawnTerrain(lat0, lon0);
    prefetchSpawnTerrain(lat0, lon0); // idempotent for the same tile
    expect(imageInstances).toHaveLength(1);
    expect(imageInstances[0]._src).toContain(`/terrarium/14/${key}.png`);

    const terrain = createTerrainSystem({
      scene: new THREE.Scene(),
      lat0,
      lon0,
      toLocal: (lat, lon) => ({ x: lon, z: lat }),
      groundSource: 'osm',
      signal: new AbortController().signal,
      onStage: vi.fn(),
      onProgress: vi.fn(),
    });
    const load = terrain.ensureHeightTiles([key]);
    await flushImages();
    expect(imageInstances).toHaveLength(1); // no second request for the same tile
    resolveImage(0);
    await expect(load).resolves.toBe(true);
    expect(takeSpawnTerrainPrefetch(key)).toBeNull();

    terrain.evictFar(0, 0, 0);
    const reload = terrain.ensureHeightTiles([key]);
    await vi.waitFor(() => expect(imageInstances).toHaveLength(2));
    resolveImage(1);
    await expect(reload).resolves.toBe(true);
    terrain.dispose();
  });

  it('retries the spawn tile when the early request failed', async () => {
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
    const lat0 = 55.9505;
    const lon0 = -3.1875;
    const key = spawnTerrainTileKey(lat0, lon0);
    prefetchSpawnTerrain(lat0, lon0);
    imageInstances[0].onerror();

    const terrain = createTerrainSystem({
      scene: new THREE.Scene(),
      lat0,
      lon0,
      toLocal: (lat, lon) => ({ x: lon, z: lat }),
      groundSource: 'osm',
      signal: new AbortController().signal,
      onStage: vi.fn(),
      onProgress: vi.fn(),
    });
    const load = terrain.ensureHeightTiles([key]);
    await vi.waitFor(() => expect(imageInstances).toHaveLength(2));
    resolveImage(1);
    await expect(load).resolves.toBe(true);
    terrain.dispose();
  });
});
