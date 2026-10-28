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
import { DEMO_PLACES, demoHeadingRadians, demoPlaceNear, demoPresetNear, streetUrl } from '../lib/geo.js';
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

describe('cell enrichment', () => {
  it('derives detail patches and applies source features without mutating input', async () => {
    const { deriveCellEnrichment, applyCellEnrichment } = await import('../lib/engine/cell-enrichment.js');
    const city = {
      elements: [{
        type: 'way', id: 12,
        tags: { building: 'yes', 'roof:shape': 'gabled' },
        geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 2.001 }, { lat: 1.001, lon: 2 }],
      }],
    };
    const enrichment = deriveCellEnrichment(city, {
      sources: ['natural-earth'],
      features: [{
        kind: 'ocean', source: 'natural-earth',
        geometry: [[2, 1], [2.01, 1], [2.01, 0.99], [2, 1]],
      }],
    });
    const enriched = applyCellEnrichment({ ...city, enrichment });
    expect(enrichment.patches['way/12']['roof:shape']).toBe('gabled');
    expect(enriched.elements).toHaveLength(2);
    expect(enriched.elements[1].tags.water).toBe('sea');
    expect(city.elements).toHaveLength(1);
  });

  it('turns directed OSM coastline data into a compact ocean fallback', async () => {
    const { deriveCellEnrichment } = await import('../lib/engine/cell-enrichment.js');
    const enrichment = deriveCellEnrichment({ elements: [{
      type: 'way', id: 9, tags: { natural: 'coastline' },
      geometry: [{ lat: 18.94, lon: 72.82 }, { lat: 18.95, lon: 72.82 }],
    }] });
    expect(enrichment.counts.coastline).toBe(1);
    expect(enrichment.features[0].kind).toBe('ocean');
    expect(enrichment.features[0].geometry.length).toBeGreaterThanOrEqual(5);
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
    expect(allDestinations().map((p) => p.name)).toEqual(['Pune', 'Edinburgh', 'Tokyo', 'New York']);
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
    expect(groundTileUrl('osm', 15, 10, 20)).toContain('voyager_nolabels/15/10/20');
    expect(groundTileUrl('satellite', 15, 10, 20)).toContain('World_Imagery');
    expect(groundTileUrl('satellite', 15, 10, 20)).toContain('/15/20/10');
  });

  it('distinguishes pale map water from land colours', async () => {
    const { isMapWaterRgb } = await import('../lib/engine/ground-tiles.js');
    expect(isMapWaterRgb(170, 211, 223)).toBe(true);
    expect(isMapWaterRgb(213, 232, 235)).toBe(true); // Carto Voyager ocean at Goa
    expect(isMapWaterRgb(242, 239, 233)).toBe(false);
    expect(isMapWaterRgb(181, 216, 163)).toBe(false);
    expect(isMapWaterRgb(120, 120, 120)).toBe(false);
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

describe('ui helpers', () => {
  it('formats clock and weather labels', async () => {
    const { formatClock, formatWeatherLabel } = await import('../lib/ui.js');
    expect(formatClock(12)).toBe('12:00 PM');
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(18.5)).toBe('6:30 PM');
    expect(formatWeatherLabel(0)).toBe('Clear sky');
    expect(formatWeatherLabel(90, 24)).toBe('24°C Rain');
  });
});

describe('facade UV (17.5)', () => {
  it('remaps wall UVs into storefront / window bands', async () => {
    const THREE = await import('three');
    const { remapWallUVs, wantsStorefront, STORE_V1, WIN_V0 } = await import('../lib/engine/facade-uv.js');
    expect(wantsStorefront({ building: 'retail' })).toBe(true);
    expect(wantsStorefront({ building: 'house' })).toBe(false);
    const geo = new THREE.BoxGeometry(4, 6.4, 0.2);
    geo.translate(0, 3.2, 0);
    remapWallUVs(geo, { base: -1.5, height: 6.4, shopfront: true, seed: 1 });
    const uv = geo.attributes.uv;
    expect(uv).toBeTruthy();
    let minV = 1, maxV = 0;
    for (let i = 0; i < uv.count; i++) {
      const v = uv.getY(i);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    expect(minV).toBeLessThan(STORE_V1);
    expect(maxV).toBeGreaterThan(WIN_V0);
  });
});

describe('vehicle controller (18.1)', () => {
  it('accelerates and steers without entering buildings', async () => {
    const { createVehicleController } = await import('../lib/engine/street/vehicle.js');
    const vc = createVehicleController({
      insideBuilding: () => false,
      groundHeight: () => 10,
    });
    expect(vc.enter({ x: 0, z: 0, heading: 0, speed: 2 }, 0)).toBe(true);
    // mesh heading kept as-is (+Z forward)
    expect(vc.state.heading).toBeCloseTo(0, 5);
    const pose = vc.update(0.5, { f: 1, r: 0.2 }, { nearRoad: true });
    expect(pose.speed).toBeGreaterThan(2);
    expect(Math.hypot(pose.x, pose.z)).toBeGreaterThan(0.5);
    const exit = vc.exit();
    expect(vc.active).toBe(false);
    expect(exit.carIndex).toBe(0);
  });

  it('WASD: W moves along nose, A/D turns the car heading', async () => {
    const { createVehicleController } = await import('../lib/engine/street/vehicle.js');
    const vc = createVehicleController({
      insideBuilding: () => false,
      groundHeight: () => 0,
    });
    vc.enter({ x: 0, z: 0, heading: 0, speed: 8 }, 0);
    const h0 = vc.state.heading;
    // W + D: accelerate and turn right
    const pose = vc.update(0.4, { f: 1, r: 1 }, { nearRoad: true });
    expect(pose.heading).not.toBeCloseTo(h0, 2);
    expect(pose.z).toBeGreaterThan(0); // heading 0 → +Z
  });
});

describe('road materials', () => {
  it('maps highway class to asphalt marking kind', async () => {
    const { roadMarkKind } = await import('../lib/engine/materials.js');
    expect(roadMarkKind('primary')).toBe('arterial');
    expect(roadMarkKind('residential')).toBe('residential');
    expect(roadMarkKind('footway')).toBe('path');
    expect(roadMarkKind('service')).toBe('plain');
  });
});

describe('nameplate exterior placement', () => {
  it('pushes labels out of a square footprint toward the road', async () => {
    const { placeOutsideBuilding } = await import('../lib/engine/population.js');
    const inside = (x, z) => Math.abs(x) < 5 && Math.abs(z) < 5;
    const roads = [{ pts: [{ x: 0, y: 12 }, { x: 0, y: 20 }] }];
    const out = placeOutsideBuilding(0, 0, inside, { roadPaths: roads });
    expect(out.moved).toBe(true);
    expect(inside(out.x, out.z)).toBe(false);
    expect(out.z).toBeGreaterThan(4);
  });

  it('mounts signs flat on the street-facing wall, sized to the wall', async () => {
    const { mountOnFacade } = await import('../lib/engine/population.js');
    // 10 x 6 building, road runs along z = 12 (south of the +z wall)
    const fp = { poly: [[-5, -3], [5, -3], [5, 3], [-5, 3]], meta: { id: 1 } };
    const roads = [{ pts: [{ x: -30, y: 12 }, { x: 30, y: 12 }] }];
    const m = mountOnFacade(4, 0, [fp], { roadPaths: roads, halfW: 7 });
    expect(m.faceX).toBeCloseTo(0);
    expect(m.faceZ).toBeCloseTo(1);
    expect(m.z).toBeCloseTo(3.12);
    expect(m.halfW).toBeLessThanOrEqual(4.7); // fits inside the 10 m wall
    expect(Math.abs(m.x) + m.halfW).toBeLessThanOrEqual(5);
    // same building with the ring reversed: outward normal must not flip inward
    const rev = mountOnFacade(4, 0, [{ ...fp, poly: [...fp.poly].reverse() }], { roadPaths: roads, halfW: 7 });
    expect(rev.faceZ).toBeCloseTo(1);
  });

  it('skips party walls whose outside is another building', async () => {
    const { mountOnFacade } = await import('../lib/engine/population.js');
    const fp = { poly: [[0, 0], [6, 0], [6, 6], [0, 6]] };
    const neighbour = (x, z) => x > 6 && x < 12 && z > 0 && z < 6;
    const roads = [{ pts: [{ x: 9, y: -40 }, { x: 9, y: 40 }] }]; // road beyond the neighbour
    const m = mountOnFacade(5.5, 3, [fp], { roadPaths: roads, halfW: 2, insideBuilding: neighbour });
    expect(m.faceX).not.toBeCloseTo(1); // never on the shared x = 6 wall
  });
});

describe('tier-0 traffic heuristics', () => {
  it('slows arterials at rush hour and weights roads by class', async () => {
    const { congestionFactor, pickWeightedRoad, CAR_DENSITY } = await import('../lib/engine/population.js');
    expect(congestionFactor(8, 'primary')).toBeLessThan(congestionFactor(3, 'primary'));
    expect(congestionFactor(8, 'residential')).toBeGreaterThan(congestionFactor(8, 'motorway'));
    expect(CAR_DENSITY.motorway).toBeGreaterThan(CAR_DENSITY.residential);
    const roads = [
      { hw: 'residential', width: 6, oneway: false },
      { hw: 'primary', width: 13, oneway: false },
    ];
    const picks = { residential: 0, primary: 0 };
    for (let i = 0; i < 200; i++) picks[pickWeightedRoad(roads).hw]++;
    expect(picks.primary).toBeGreaterThan(picks.residential);
  });

  it('accepts a deterministic random source for repeatable traffic placement', async () => {
    const { pickWeightedRoad } = await import('../lib/engine/population.js');
    const { createSeededRandom } = await import('../lib/engine/seeded-random.js');
    const roads = [
      { hw: 'residential', width: 6, oneway: false },
      { hw: 'primary', width: 13, oneway: false },
    ];
    expect(pickWeightedRoad(roads, () => 0)).toBe(roads[0]);
    expect(pickWeightedRoad(roads, () => 0.999999)).toBe(roads[1]);
    const a = createSeededRandom(1337);
    const b = createSeededRandom(1337);
    const valuesA = Array.from({ length: 16 }, a);
    expect(valuesA).toEqual(Array.from({ length: 16 }, b));
    expect(valuesA.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(Array.from({ length: 16 }, createSeededRandom(1338))).not.toEqual(valuesA);
  });

  it('cycles traffic signals red → amber → green (18.6)', async () => {
    const { signalPhase, SIGNAL_CYCLE } = await import('../lib/engine/population.js');
    expect(signalPhase(0)).toBe('red');
    expect(signalPhase(12)).toBe('amber');
    expect(signalPhase(16)).toBe('green');
    expect(signalPhase(SIGNAL_CYCLE)).toBe('red');
    expect(signalPhase(5, 20)).toBe('green'); // offset wraps into green
  });
});

describe('gpu auto quality (16.3)', () => {
  it('returns a valid quality tier', async () => {
    const { detectGpuQuality } = await import('../lib/engine/gpu-tier.js');
    const q = detectGpuQuality(null);
    expect(['low', 'medium', 'high']).toContain(q);
  });
});

describe('walk trail buffer (10.5)', () => {
  it('dedupes close points and caps length', async () => {
    const { createTrailBuffer } = await import('../lib/engine/trail-buffer.js');
    const buf = createTrailBuffer();
    expect(buf.push(18.52, 73.85)).toBe(true);
    expect(buf.push(18.52, 73.85)).toBe(false); // too close
    expect(buf.push(18.521, 73.851)).toBe(true);
    expect(buf.points.length).toBe(2);
    expect(buf.takeDirty()?.length).toBe(2);
    expect(buf.takeDirty()).toBeNull();
  });
});

describe('walk card (10.5)', () => {
  it('renders a canvas with passport stats', async () => {
    const { renderWalkCard } = await import('../lib/engine/walk-card.js');
    // jsdom may lack canvas — skip soft if so
    if (typeof document === 'undefined' || !document.createElement('canvas').getContext) {
      return;
    }
    const c = renderWalkCard(
      {
        totalKm: 1.25,
        elevClimbed: 40,
        cities: { Pune: { km: 1.25 } },
        countries: { India: 1 },
        trail: [
          { lat: 18.52, lon: 73.85 },
          { lat: 18.521, lon: 73.851 },
        ],
      },
      { place: 'Pune, India' }
    );
    expect(c.width).toBe(720);
    expect(c.height).toBe(420);
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
          tags: { highway: 'residential', lanes: '4', oneway: 'yes', width: '13m' },
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
    expect(result.roadDecals[0].markingProfile).toEqual({ lanes: 4, oneWay: true });
    const roadGeo = result.roadDecals[0].geo;
    const roadPositions = roadGeo.position.array;
    const roadIndices = roadGeo.index;
    const a = roadIndices[0] * 3, b = roadIndices[1] * 3, c = roadIndices[2] * 3;
    const abx = roadPositions[b] - roadPositions[a];
    const abz = roadPositions[b + 2] - roadPositions[a + 2];
    const acx = roadPositions[c] - roadPositions[a];
    const acz = roadPositions[c + 2] - roadPositions[a + 2];
    expect(abz * acx - abx * acz).toBeGreaterThan(0);
    expect(transfers.length).toBeGreaterThan(0);
  });
});

describe('near street treatment', () => {
  it('adds bounded sidewalks and kerbs around nearby walkable roads only', async () => {
    const { buildNearStreetTreatmentGeometry } = await import('../lib/engine/street/near-street-treatment.js');
    const result = await buildNearStreetTreatmentGeometry({
      player: { x: 0, z: 0 },
      roadPaths: [
        {
          width: 7,
          tags: { highway: 'residential' },
          pts: [{ x: -120, y: 0 }, { x: 120, y: 0 }],
        },
        {
          width: 7,
          tags: { highway: 'residential' },
          pts: [{ x: -120, y: 160 }, { x: 120, y: 160 }],
        },
      ],
      groundHeight: () => 0,
    });
    expect(result.sidewalks?.getAttribute('position').count).toBeGreaterThan(0);
    expect(result.curbs?.getAttribute('position').count).toBeGreaterThan(0);
    expect(result.sidewalks?.getAttribute('uv').count).toBe(result.sidewalks?.getAttribute('position').count);
    const sidewalkPositions = result.sidewalks.getAttribute('position');
    for (let i = 0; i < sidewalkPositions.count; i++) {
      const x = sidewalkPositions.getX(i);
      const z = sidewalkPositions.getZ(i);
      expect(Math.hypot(x, z)).toBeLessThan(86);
    }
  });

  it('can treat every road in a streamed cell and assigns metre-scaled paving UVs', async () => {
    const { buildNearStreetTreatmentGeometry } = await import('../lib/engine/street/near-street-treatment.js');
    const result = await buildNearStreetTreatmentGeometry({
      player: { x: 0, z: 0 },
      radius: Infinity,
      roadPaths: [{
        width: 7,
        tags: { highway: 'residential' },
        pts: [{ x: -20, y: 160 }, { x: 20, y: 160 }],
      }],
    });
    const positions = result.sidewalks.getAttribute('position');
    const uvs = result.sidewalks.getAttribute('uv');
    expect(positions.count).toBeGreaterThan(0);
    expect(uvs.count).toBe(positions.count);
    const farthest = Math.max(...Array.from({ length: positions.count }, (_, i) =>
      Math.hypot(positions.getX(i), positions.getZ(i))
    ));
    expect(farthest).toBeGreaterThan(160);
  });
});

describe('road marking profiles', () => {
  it('uses lane direction tags first and infers a bounded lane count from width', async () => {
    const { roadMarkingProfile } = await import('../lib/engine/road-markings.js');
    expect(roadMarkingProfile({ lanes: '3', 'lanes:forward': '2', 'lanes:backward': '2', oneway: 'yes' }))
      .toEqual({ lanes: 3, oneWay: true });
    expect(roadMarkingProfile({ width: "26'", oneway: '-1' }))
      .toEqual({ lanes: 2, oneWay: true });
    expect(roadMarkingProfile({ width: '80m' }))
      .toEqual({ lanes: 8, oneWay: false });
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

  it('adds the low-cost reflection horizon only for wet dusk and night', async () => {
    const { wetNightHorizonAlpha } = await import('../lib/engine/env-map.js');
    expect(wetNightHorizonAlpha(12, 0.9)).toBe(0);
    expect(wetNightHorizonAlpha(21, 0)).toBe(0);
    expect(wetNightHorizonAlpha(21, 0.9)).toBeCloseTo(0.288);
    expect(wetNightHorizonAlpha(21, 1.4)).toBeCloseTo(0.32);
    expect(wetNightHorizonAlpha(18, 0.9)).toBeCloseTo(0.162);
  });
});

describe('cell-clip ownership', () => {
  it('keeps corridors unclipped and buildings by tile ownership', async () => {
    const {
      clipElementsToCell,
      takeUnseenElements,
      forgetElementIds,
      CELL_STEP,
    } = await import('../lib/engine/cell-clip.js');
    const lat0 = 18.52;
    const lon0 = 73.855;
    const els = [
      {
        type: 'way',
        id: 1,
        tags: { highway: 'primary' },
        geometry: [
          { lat: lat0 + CELL_STEP, lon: lon0 },
          { lat: lat0 + CELL_STEP * 2, lon: lon0 },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { building: 'yes' },
        geometry: [
          { lat: lat0 + 0.0001, lon: lon0 },
          { lat: lat0 + 0.0002, lon: lon0 },
          { lat: lat0 + 0.0002, lon: lon0 + 0.0001 },
        ],
      },
      {
        type: 'way',
        id: 3,
        tags: { building: 'yes' },
        geometry: [
          { lat: lat0 + CELL_STEP, lon: lon0 },
          { lat: lat0 + CELL_STEP + 0.0001, lon: lon0 },
        ],
      },
    ];
    const owned = clipElementsToCell(els, lat0, lon0);
    expect(owned.some((e) => e.id === 1)).toBe(true);
    expect(owned.some((e) => e.id === 2)).toBe(true);
    expect(owned.some((e) => e.id === 3)).toBe(false);

    const seen = new Set();
    const first = takeUnseenElements(owned, seen);
    expect(first.elements.length).toBe(2);
    const again = takeUnseenElements(owned, seen);
    expect(again.elements.length).toBe(0);
    forgetElementIds(first.ids, seen);
    const afterForget = takeUnseenElements(owned, seen);
    expect(afterForget.elements.length).toBe(2);
  });
});

describe('demo presets', () => {
  it('every demo place has a pleasant clear preset', () => {
    for (const p of DEMO_PLACES) {
      expect(p.preset.hour).toBeGreaterThanOrEqual(17);
      expect(p.preset.hour).toBeLessThanOrEqual(19);
      expect(p.preset.weather).toBe(0);
      expect(p.preset.headingDeg).toBeGreaterThanOrEqual(0);
      expect(p.preset.headingDeg).toBeLessThan(360);
    }
  });
  it('looks up the nearest demo place within 300 m only', () => {
    expect(demoPresetNear(40.758, -73.9855)).toEqual({ hour: 18, weather: 0, headingDeg: 292 });
    expect(demoPlaceNear(35.6597, 139.7007).name).toBe('Tokyo');
    expect(demoPresetNear(35.67, 139.7005)).toBeNull();
    expect(demoPresetNear(NaN, 0)).toBeNull();
  });
  it('normalizes demo headings to the street engine frame', () => {
    expect(demoHeadingRadians({ headingDeg: 270 })).toBeCloseTo(3 * Math.PI / 2);
    expect(demoHeadingRadians({ headingDeg: -11 })).toBeCloseTo(349 * Math.PI / 180);
    expect(demoHeadingRadians({ headingDeg: 360 })).toBe(0);
    expect(demoHeadingRadians({})).toBeNull();
  });
  it('Pune start stays within 200 m of Koregaon Park', () => {
    const p = DEMO_PLACES.find((d) => d.name === 'Pune');
    const d = Math.hypot((p.lat - 18.540913) * 110540, (p.lon - 73.895553) * 111320 * Math.cos(18.54 * Math.PI / 180));
    expect(d).toBeLessThan(200);
  });
  it('builds street URLs with optional demo flag', () => {
    expect(streetUrl(1, 2)).toBe('/street?lat=1&lon=2');
    expect(streetUrl(1, 2, { demo: true })).toBe('/street?lat=1&lon=2&demo=1');
  });
});
