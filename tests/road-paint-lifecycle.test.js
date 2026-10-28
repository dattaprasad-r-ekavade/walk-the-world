import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('@/lib/engine/props', () => ({ placeProps: vi.fn(async () => {}) }));
vi.mock('@/lib/engine/materials', () => ({
  getBuildingMaterial: vi.fn(() => ({})),
  getRoofMaterial: vi.fn(() => ({})),
  getRoadMaterial: vi.fn(() => ({ transparent: true, depthWrite: false })),
  getSidewalkMaterial: vi.fn(() => ({})),
  getRailMaterial: vi.fn(() => ({})),
  getSimpleStandard: vi.fn(() => ({})),
}));
vi.mock('@/lib/engine/textures', () => ({ makeRailTexture: vi.fn(() => ({})) }));

import { assembleCityFromBuild } from '@/lib/engine/street/assemble-city';

class FakePath2D {
  moveTo() {}
  lineTo() {}
  closePath() {}
}

function makeBuild() {
  return {
    walls: [], roofCaps: [], pitchedRoofs: [], clutter: null, livedIn: null,
    roadDecals: [], flats: [], trees: null, tris: 0,
    meta: {
      roadPaths: [{
        id: 'way/road-1',
        pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        width: 4,
        tags: { highway: 'residential' },
      }],
      buildingRings: [], roadPoints: [], props: [], stations: [], bridges: [],
      rails: [], barrierWays: [], powerLines: [], waterways: [], crossings: [],
      footprints: [], pois: [],
    },
  };
}

function makeContext(tileCanvases) {
  const scene = new THREE.Scene();
  const engineRef = { current: { buildingMats: [], roadPaths: [], lampPoolMaterials: [] } };
  return {
    scene,
    groundHeight: () => 0,
    toLocal: () => ({ x: 0, z: 0 }),
    addFootprint: vi.fn(),
    insideBuilding: () => false,
    tileCanvases,
    engineRef,
    player: { x: 0, z: 0, heading: 0, moving: false },
    lat0: 1,
    lon0: 2,
    spinners: [],
    lampGlows: [],
    appendMeta: true,
    skipOverture: true,
    skipPlayerSpawn: true,
  };
}

describe('road paint lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('repaints a road onto a ground canvas loaded after its first assembly', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('Path2D', FakePath2D);
    const tileCanvases = [];
    const ctx = makeContext(tileCanvases);
    const build = makeBuild();

    await assembleCityFromBuild(build, ctx);
    expect(ctx.engineRef.current.roadPaths).toHaveLength(1);

    const raster = {
      x0: -20, z0: -20, sizeX: 40, sizeZ: 40, w: 256,
      g: { stroke: vi.fn() },
    };
    let uploadCount = 0;
    const texture = { set needsUpdate(value) { if (value) uploadCount++; } };
    raster.texture = texture;
    tileCanvases.push(raster);

    await assembleCityFromBuild(build, ctx);
    expect(raster.g.stroke).toHaveBeenCalledOnce();
    expect(uploadCount).toBe(1);
  });
});
