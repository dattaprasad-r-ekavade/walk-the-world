import { describe, it, expect } from 'vitest';
import { lon2tx, lat2ty, tx2lon, ty2lat, makeLocalFrame } from '../lib/engine/geo.js';
import {
  parseOsmColor,
  quantizeColor,
  buildingWallColor,
  buildingRoofColor,
  pitchedRoofColor,
  wantsPitchedRoof,
} from '../lib/engine/styles.js';
import { dailyDestination, allDestinations } from '../lib/daily.js';
import { streetShareUrl, photoFilename } from '../lib/share.js';

describe('engine/geo', () => {
  it('converts slippy tile coordinates', () => {
    const z = 14;
    const lat = 41.8902;
    const lon = 12.4922;
    const tx = lon2tx(lon, z);
    const ty = lat2ty(lat, z);
    expect(tx).toBeGreaterThan(0);
    expect(ty).toBeGreaterThan(0);
    expect(tx2lon(Math.floor(tx), z)).toBeLessThan(lon + 1);
    expect(ty2lat(Math.floor(ty), z)).toBeLessThan(lat + 1);
  });

  it('builds a local ENU frame', () => {
    const { toLocal, toGeo } = makeLocalFrame(41.89, 12.49);
    const local = toLocal(41.89, 12.49);
    expect(Math.abs(local.x)).toBeLessThan(1);
    expect(Math.abs(local.z)).toBeLessThan(1);
    const back = toGeo(local.x, local.z);
    expect(Math.abs(back.lat - 41.89)).toBeLessThan(0.001);
    expect(Math.abs(back.lon - 12.49)).toBeLessThan(0.001);
  });
});

describe('street/collision', () => {
  it('detects point inside footprint', async () => {
    const { createCollision } = await import('../lib/engine/street/collision.js');
    const { addFootprint, insideBuilding } = createCollision(60);
    addFootprint([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(insideBuilding(5, 5)).toBe(true);
    expect(insideBuilding(50, 50)).toBe(false);
  });
});

describe('street/ground-height', () => {
  it('samples bilinear height from terrain tiles', async () => {
    const { createGroundHeight } = await import('../lib/engine/street/ground-height.js');
    const tiles = new Map();
    const N = 3;
    tiles.set('0/0', {
      heights: new Float32Array([0, 10, 20, 30, 40, 50, 60, 70, 80]),
      n: N,
      x0: 0,
      z0: 0,
      sizeX: 100,
      sizeZ: 100,
    });
    const groundHeight = createGroundHeight(tiles);
    expect(groundHeight(50, 50)).toBeGreaterThan(0);
    expect(groundHeight(10, 10)).toBeLessThan(groundHeight(90, 90));
  });
});

describe('OSM appearance tags (17.3)', () => {
  it('parses hex, named, and rgb colours', () => {
    expect(parseOsmColor('#ff0000')).toBe(0xff0000);
    expect(parseOsmColor('#f00')).toBe(0xff0000);
    expect(parseOsmColor('red')).toBe(0xb8433a);
    expect(parseOsmColor('rgb(10, 20, 30)')).toBe((10 << 16) | (20 << 8) | 30);
    expect(parseOsmColor('aabbcc')).toBe(0xaabbcc);
    expect(parseOsmColor('')).toBeNull();
    expect(parseOsmColor('not-a-color')).toBeNull();
  });

  it('quantizes similar shades into shared buckets', () => {
    expect(quantizeColor(0xe3ddd2)).toBe(quantizeColor(0xe3ddd2));
    expect(quantizeColor(0x010101, 24)).toBe(0x000000);
  });

  it('prefers building:colour over type palette', () => {
    expect(buildingWallColor({ building: 'house', 'building:colour': '#112233' }, 8)).toBe(
      quantizeColor(0x112233)
    );
    expect(buildingWallColor({ building: 'house' }, 8)).toBe(0xe3d3b8);
    expect(buildingWallColor({ 'building:material': 'brick' }, 8)).toBe(quantizeColor(0xa85a45));
  });

  it('reads roof:colour and roof:shape', () => {
    expect(buildingRoofColor({ 'roof:colour': 'red' })).toBe(quantizeColor(0xb8433a));
    expect(pitchedRoofColor({ 'roof:colour': '#224466' })).toBe(quantizeColor(0x224466));
    expect(wantsPitchedRoof({ 'roof:shape': 'gabled' }, 500, 40)).toBe(true);
    expect(wantsPitchedRoof({ 'roof:shape': 'flat' }, 80, 8)).toBe(false);
    expect(wantsPitchedRoof({ building: 'house' }, 100, 8)).toBe(true);
    expect(wantsPitchedRoof({ building: 'office' }, 100, 8)).toBe(false);
  });
});

describe('daily destination (15.4)', () => {
  it('returns a stable pick for a UTC date', () => {
    const a = dailyDestination(new Date('2026-07-09T12:00:00Z'));
    const b = dailyDestination(new Date('2026-07-09T23:59:00Z'));
    const c = dailyDestination(new Date('2026-07-10T01:00:00Z'));
    expect(a).toBeTruthy();
    expect(a.name).toBe(b.name);
    expect(a.lat).toBeTypeOf('number');
    expect(a.lon).toBeTypeOf('number');
    expect(allDestinations().length).toBeGreaterThan(20);
    expect(c).toBeTruthy();
  });
});

describe('where-am-i round (15.5)', () => {
  it('builds 4 unique options including the answer', async () => {
    const { whereAmIRound } = await import('../lib/daily.js');
    const round = whereAmIRound();
    expect(round).toBeTruthy();
    expect(round.options).toHaveLength(4);
    expect(new Set(round.options).size).toBe(4);
    expect(round.options).toContain(round.answer);
    expect(round.lat).toBeTypeOf('number');
  });
});

describe('ground tiles (17.4)', () => {
  it('builds osm and esri urls', async () => {
    const { groundTileUrl } = await import('../lib/engine/ground-tiles.js');
    expect(groundTileUrl('osm', 15, 10, 20)).toContain('openstreetmap.org/15/10/20');
    expect(groundTileUrl('satellite', 15, 10, 20)).toContain('World_Imagery');
    expect(groundTileUrl('satellite', 15, 10, 20)).toContain('/15/20/10');
  });
});

describe('share helpers', () => {
  it('builds /street deep links', () => {
    expect(streetShareUrl(18.5196, 73.8554, 'https://example.com')).toBe(
      'https://example.com/street?lat=18.51960&lon=73.85540'
    );
    expect(streetShareUrl(null, 1)).toBeNull();
  });

  it('builds photo filenames', () => {
    const name = photoFilename('Pune, Maharashtra', 18.52, 73.85);
    expect(name).toMatch(/^walktheworld-Pune-Maharashtra-\d{4}-\d{2}-\d{2}\.png$/);
  });
});

describe('city builder core (19.1)', () => {
  it('extrudes a building and returns transferable buffers', async () => {
    const { buildCityGeometry } = await import('../lib/engine/city-builder-core.js');
    const N = 3;
    const heights = new Float32Array(N * N).fill(10);
    const { result, transfers } = buildCityGeometry({
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { building: 'house', 'building:levels': '2' },
          geometry: [
            { lat: 18.5200, lon: 73.8550 },
            { lat: 18.5201, lon: 73.8550 },
            { lat: 18.5201, lon: 73.8551 },
            { lat: 18.5200, lon: 73.8551 },
            { lat: 18.5200, lon: 73.8550 },
          ],
        },
        {
          type: 'way',
          id: 2,
          tags: { highway: 'residential' },
          geometry: [
            { lat: 18.5199, lon: 73.8549 },
            { lat: 18.5202, lon: 73.8552 },
          ],
        },
      ],
      lat0: 18.52,
      lon0: 73.855,
      terrainTiles: [{
        key: '0/0',
        heights,
        n: N,
        x0: -200,
        z0: -200,
        sizeX: 400,
        sizeZ: 400,
      }],
    });
    expect(result.buildingCount).toBe(1);
    expect(result.walls.length).toBeGreaterThan(0);
    expect(result.walls[0].geo.position.array).toBeInstanceOf(Float32Array);
    expect(result.meta.roadPaths.length).toBe(1);
    expect(transfers.length).toBeGreaterThan(0);
  });
});

describe('env map (17.2)', () => {
  it('paints an equirect sky canvas', async () => {
    const { paintSkyEquirect } = await import('../lib/engine/env-map.js');
    // jsdom may lack canvas — skip gracefully
    if (typeof document === 'undefined' || !document.createElement('canvas').getContext) {
      return;
    }
    const c = paintSkyEquirect(12, 0);
    expect(c.width).toBe(512);
    expect(c.height).toBe(256);
  });
});
