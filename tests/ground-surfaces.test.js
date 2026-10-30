import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GROUND_SURFACE_STYLE, buildDrapedSurface, groundSurfaceKind, orientUrbanGroundRing, worldPlanarUVs } from '@/lib/engine/ground-surfaces';
import { createGroundHeight } from '@/lib/engine/street/ground-height';
import { buildCityGeometry } from '@/lib/engine/city-builder-core';

const square = (lat, lon, d = 0.0001) => [
  { lat, lon },
  { lat: lat + d, lon },
  { lat: lat + d, lon: lon + d },
  { lat, lon: lon + d },
  { lat, lon },
];

describe('ground surfaces (B3)', () => {
  it('classifies land-use, leisure and pedestrian areas', () => {
    expect(groundSurfaceKind({ leisure: 'park' })).toEqual({ kind: 'grass' });
    expect(groundSurfaceKind({ leisure: 'garden' })).toEqual({ kind: 'grass' });
    expect(groundSurfaceKind({ landuse: 'meadow' })).toEqual({ kind: 'grass' });
    expect(groundSurfaceKind({ landuse: 'orchard' })).toEqual({ kind: 'farmland' });
    expect(groundSurfaceKind({ amenity: 'parking' })).toEqual({ kind: 'parking' });
    expect(groundSurfaceKind({ natural: 'water', 'wtw:sea_level': '0' })).toEqual({ kind: 'water', seaLevel: true });
    expect(groundSurfaceKind({ highway: 'pedestrian', area: 'yes' })).toEqual({ kind: 'paving', alsoRoad: true });
    expect(groundSurfaceKind({ place: 'square' })).toEqual({ kind: 'paving', alsoRoad: false });
    expect(groundSurfaceKind({ highway: 'pedestrian' })).toBeNull();
    // Multi-storey car parks are buildings; underground and raised areas are not ground.
    expect(groundSurfaceKind({ amenity: 'parking', building: 'yes' })).toBeNull();
    expect(groundSurfaceKind({ amenity: 'parking', parking: 'multi-storey' })).toBeNull();
    expect(groundSurfaceKind({ amenity: 'parking', parking: 'underground', layer: '-1' })).toBeNull();
    expect(groundSurfaceKind({ highway: 'pedestrian', area: 'yes', layer: '1' })).toBeNull();
    expect(groundSurfaceKind({ leisure: 'pitch', location: 'rooftop' })).toBeNull();
    expect(groundSurfaceKind({ amenity: 'parking', layer: '0' })).toEqual({ kind: 'parking' });
    expect(groundSurfaceKind({ landuse: 'residential' })).toBeNull();
    expect(groundSurfaceKind(undefined)).toBeNull();
  });

  it('shares one cached material per kind until the cache is disposed', async () => {
    const { disposeMaterialCache, getGroundSurfaceMaterial } = await import('@/lib/engine/materials');
    const grass = getGroundSurfaceMaterial('grass');
    expect(getGroundSurfaceMaterial('grass')).toBe(grass);
    expect(getGroundSurfaceMaterial('water')).not.toBe(grass);
    expect(getGroundSurfaceMaterial('water').roughness).toBe(GROUND_SURFACE_STYLE.water.roughness);
    disposeMaterialCache();
    expect(getGroundSurfaceMaterial('grass')).not.toBe(grass);
  });

  it('writes world-space UVs so tiling continues across areas', () => {
    const uv = worldPlanarUVs([4, 0, -8, 10, 1, 2], 2);
    expect([...uv]).toEqual([2, 4, 5, -1]);
  });

  it('merges every area of a kind into one surface with world UVs', () => {
    const { result } = buildCityGeometry({
      elements: [
        { type: 'way', id: 1, tags: { leisure: 'park' }, geometry: square(0, 0) },
        { type: 'way', id: 2, tags: { landuse: 'grass' }, geometry: square(0.0003, 0) },
        { type: 'way', id: 3, tags: { amenity: 'parking' }, geometry: square(0, 0.0003) },
        { type: 'way', id: 4, tags: { highway: 'pedestrian', area: 'yes' }, geometry: square(0.0003, 0.0003) },
      ],
      lat0: 0,
      lon0: 0,
      terrainTiles: [],
    });
    const kinds = result.flats.map((flat) => flat.kind).sort();
    expect(kinds).toEqual(['grass', 'parking', 'paving']);
    const grass = result.flats.find((flat) => flat.kind === 'grass');
    const positions = grass.geo.position.array;
    const uvs = grass.geo.uv.array;
    expect(positions.length / 3).toBe(uvs.length / 2);
    expect(positions.length / 3).toBeGreaterThanOrEqual(8); // both areas
    const { repeat, lift } = GROUND_SURFACE_STYLE.grass;
    expect(uvs[0]).toBeCloseTo(positions[0] / repeat, 5);
    expect(positions[1]).toBeCloseTo(lift, 5);
    // The pedestrian area stays a walkable road path as well.
    expect(result.meta.roadPaths.some((road) => road.tags?.highway === 'pedestrian')).toBe(true);
  });

  it('builds a multi-storey car park as a building, not as ground', () => {
    const { result } = buildCityGeometry({
      elements: [{ type: 'way', id: 9, tags: { amenity: 'parking', parking: 'multi-storey', building: 'yes' }, geometry: square(0, 0) }],
      lat0: 0,
      lon0: 0,
      terrainTiles: [],
    });
    expect(result.buildingCount).toBe(1);
    expect(result.flats).toHaveLength(0);
  });
});

describe('terrain-draped ground surfaces', () => {
  const triangulate = (contour, steiner) => THREE.ShapeUtils.triangulateShape(
    contour.map((p) => new THREE.Vector2(p.x, p.z)),
    steiner.map((p) => [new THREE.Vector2(p.x, p.z)]),
  );
  const square = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 }, { x: 0, z: 0 }];

  it('places every vertex on the terrain plus lift, with interior points', () => {
    const slope = (x) => x * 0.2; // 20 m rise over the area
    const surface = buildDrapedSurface(square, { heightAt: (x) => slope(x), lift: 0.05, spacing: 10, triangulate });
    const p = surface.positions;
    expect(p.length / 3).toBeGreaterThan(80); // densified edges plus a grid inside
    for (let i = 0; i < p.length; i += 3) expect(p[i + 1]).toBeCloseTo(slope(p[i]) + 0.05, 4);
    // All triangles face up and no edge is much longer than the spacing.
    const idx = surface.index;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
      const up = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
      expect(up).toBeGreaterThan(0);
    }
  });

  it('leaves out triangles over unloaded terrain and drops fully uncovered areas', () => {
    const full = buildDrapedSurface(square, { heightAt: () => 30, triangulate });
    const half = buildDrapedSurface(square, { heightAt: (x) => (x < 50 ? 30 : null), lift: 0, triangulate });
    expect(half.index.length).toBeLessThan(full.index.length);
    // Only vertices used by the kept triangles remain, all on loaded terrain.
    expect(new Set(half.index).size).toBe(half.positions.length / 3);
    for (let i = 0; i < half.positions.length; i += 3) {
      expect(half.positions[i]).toBeLessThan(50);
      expect(half.positions[i + 1]).toBeCloseTo(30, 4);
    }
    expect(buildDrapedSurface(square, { heightAt: () => null, triangulate })).toBeNull();
  });

  it('caps the triangle count for very large areas', () => {
    const big = [{ x: 0, z: 0 }, { x: 3000, z: 0 }, { x: 3000, z: 3000 }, { x: 0, z: 3000 }];
    const surface = buildDrapedSurface(big, { heightAt: () => 0, triangulate });
    expect(surface.index.length / 3).toBeLessThan(4000);
  });

  it('samples terrain height on the rendered triangles, not bilinearly', () => {
    // One cell: corners 0, 0, 0 and 10 at (1, 1). Bilinear centre = 2.5;
    // the mesh diagonal runs (0,1)-(1,0), so the centre lies on it at 0.
    const tiles = new Map([['t', { heights: new Float32Array([0, 0, 0, 10]), n: 2, x0: 0, z0: 0, sizeX: 10, sizeZ: 10 }]]);
    const groundHeight = createGroundHeight(tiles);
    expect(groundHeight(5, 5)).toBeCloseTo(2.5, 5);
    expect(groundHeight.meshHeight(5, 5)).toBeCloseTo(0, 5);
    expect(groundHeight.meshHeight(7.5, 7.5)).toBeCloseTo(5, 5);
    expect(groundHeight.meshHeight(50, 50)).toBeNull();
    expect(createGroundHeight(new Map()).meshHeight(1, 1)).toBe(0);
  });
});

describe('urban land-use ground paint', () => {
  it('classifies urban land use and keeps the Overpass pattern in sync', async () => {
    const { URBAN_GROUND_STYLE, URBAN_LANDUSE_PATTERN, urbanGroundKind } = await import('@/lib/engine/ground-surfaces');
    expect(urbanGroundKind({ landuse: 'residential' })).toBe('residential');
    expect(urbanGroundKind({ landuse: 'industrial', layer: '0' })).toBe('industrial');
    expect(urbanGroundKind({ landuse: 'residential', building: 'yes' })).toBeNull();
    expect(urbanGroundKind({ landuse: 'railway', layer: '-1' })).toBeNull();
    expect(urbanGroundKind({ landuse: 'grass' })).toBeNull(); // meshed instead
    expect(urbanGroundKind({ landuse: 'constructor' })).toBeNull();
    const pattern = new RegExp(URBAN_LANDUSE_PATTERN);
    for (const kind of Object.keys(URBAN_GROUND_STYLE)) expect(pattern.test(kind)).toBe(true);
    expect(pattern.test('residentials')).toBe(false);
  });

  it('passes urban rings to assembly as local-metre rings, not meshes', () => {
    const { result } = buildCityGeometry({
      elements: [{ type: 'way', id: 7, tags: { landuse: 'residential' }, geometry: square(0, 0) }],
      lat0: 0,
      lon0: 0,
      terrainTiles: [],
    });
    expect(result.flats).toHaveLength(0);
    expect(result.meta.landuseRings).toHaveLength(1);
    const { kind, ring } = result.meta.landuseRings[0];
    expect(kind).toBe('residential');
    expect(ring).toHaveLength(5);
    expect(ring[1][1]).toBeCloseTo(-11.1, 0); // 0.0001° north is about 11 m at -z
  });

  it('stitches urban multipolygon relations and preserves inner rings', () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 0.001, lon: 0 };
    const c = { lat: 0.001, lon: 0.001 };
    const d = { lat: 0, lon: 0.001 };
    const hole = [
      { lat: 0.0003, lon: 0.0003 },
      { lat: 0.0007, lon: 0.0003 },
      { lat: 0.0007, lon: 0.0007 },
      { lat: 0.0003, lon: 0.0007 },
      { lat: 0.0003, lon: 0.0003 },
    ];
    const { result } = buildCityGeometry({
      elements: [{
        type: 'relation',
        id: 99,
        tags: { type: 'multipolygon', landuse: 'residential' },
        members: [
          { type: 'way', role: 'outer', geometry: [c, b] },
          { type: 'way', role: 'outer', geometry: [a, b] },
          { type: 'way', role: 'outer', geometry: [c, d] },
          { type: 'way', role: 'outer', geometry: [a, d] },
          { type: 'way', role: 'inner', geometry: hole },
        ],
      }],
      lat0: 0,
      lon0: 0,
      terrainTiles: [],
    });

    expect(result.meta.landuseRings.map(({ role }) => role).sort()).toEqual(['inner', 'outer']);
    for (const { ring } of result.meta.landuseRings) {
      expect(ring.length).toBe(5);
      expect(ring[0]).toEqual(ring.at(-1));
    }
    const area = (ring) => ring.reduce((sum, point, i) => {
      const next = ring[(i + 1) % ring.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    const outer = result.meta.landuseRings.find(({ role }) => role === 'outer').ring;
    const inner = result.meta.landuseRings.find(({ role }) => role === 'inner').ring;
    expect(area(orientUrbanGroundRing(outer, 'outer'))).toBeGreaterThan(0);
    expect(area(orientUrbanGroundRing(inner, 'inner'))).toBeLessThan(0);
  });

  it('drops an incomplete relation ring instead of closing a false polygon', () => {
    const { result } = buildCityGeometry({
      elements: [{
        type: 'relation',
        id: 100,
        tags: { type: 'multipolygon', landuse: 'residential' },
        members: [{
          type: 'way',
          role: 'outer',
          geometry: [{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 }],
        }],
      }],
      lat0: 0,
      lon0: 0,
      terrainTiles: [],
    });
    expect(result.meta.landuseRings).toEqual([]);
  });
});
