import { describe, expect, it } from 'vitest';
import { GROUND_SURFACE_STYLE, groundSurfaceKind, worldPlanarUVs } from '@/lib/engine/ground-surfaces';
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
});
