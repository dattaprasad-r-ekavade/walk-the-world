import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const fixtureDirectory = new URL('../benchmarks/fixtures/', import.meta.url);
const readFixture = (filename) => JSON.parse(readFileSync(new URL(filename, fixtureDirectory), 'utf8'));

describe('synthetic benchmark fixtures', () => {
  const showcase = readFixture('synthetic-showcase.json');
  const dense = readFixture('synthetic-dense.json');
  const sparse = readFixture('synthetic-sparse.json');
  const difficult = readFixture('synthetic-difficult-polygons.json');
  const propHeavy = readFixture('synthetic-prop-heavy.json');
  const rome = readFixture('rome-showcase-osm.json');

  it('records reproducible provenance and a data license for every generated fixture', () => {
    for (const fixture of [showcase, dense, sparse, difficult, propHeavy]) {
      expect(fixture.benchmarkFixture).toMatchObject({
        dataKind: expect.stringContaining('synthetic'),
        provenance: 'Generated deterministically by scripts/build-benchmark-fixtures.mjs',
        license: 'CC0-1.0',
      });
      expect(fixture.elements.length).toBeGreaterThan(0);
    }
  });

  it('keeps density tiers ordered and includes a high-vertex polygon workload', () => {
    expect(dense.benchmarkFixture.featureCounts.buildings).toBeGreaterThan(showcase.benchmarkFixture.featureCounts.buildings);
    expect(showcase.benchmarkFixture.featureCounts.buildings).toBeGreaterThan(sparse.benchmarkFixture.featureCounts.buildings);
    expect(Math.max(...difficult.benchmarkFixture.polygonVertexCounts)).toBe(96);
  });

  it('uses valid geographic vertices and minimum polygon rings', () => {
    for (const fixture of [showcase, dense, sparse, difficult]) {
      for (const element of fixture.elements) {
        if (!element.geometry) continue;
        expect(element.geometry.length).toBeGreaterThanOrEqual(element.tags?.building ? 3 : 2);
        for (const point of element.geometry) {
          expect(point.lat).toBeGreaterThanOrEqual(-90);
          expect(point.lat).toBeLessThanOrEqual(90);
          expect(point.lon).toBeGreaterThanOrEqual(-180);
          expect(point.lon).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it('contains 256 deterministic prop markers for material-batching benchmarks', async () => {
    expect(propHeavy.benchmarkFixture.featureCounts).toEqual({ staticProps: 256, roads: 1, propKinds: 8 });
    expect(propHeavy.elements.filter((element) => element.type === 'node' && element.tags).length).toBe(256);

    const { buildCityGeometry } = await import('../lib/engine/city-builder-core.js');
    const { result, transfers } = buildCityGeometry({
      elements: propHeavy.elements,
      lat0: propHeavy.benchmarkFixture.center.lat,
      lon0: propHeavy.benchmarkFixture.center.lon,
    });
    expect(result.meta.props).toHaveLength(256);
    expect(result.meta.roadPaths).toHaveLength(1);
    expect(transfers.length).toBeGreaterThan(0);
  });

  it('builds every synthetic workload through the production geometry path', async () => {
    const { buildCityGeometry } = await import('../lib/engine/city-builder-core.js');
    for (const fixture of [showcase, dense, sparse, difficult]) {
      const { result, transfers } = buildCityGeometry({
        elements: fixture.elements,
        lat0: fixture.benchmarkFixture.center.lat,
        lon0: fixture.benchmarkFixture.center.lon,
      });
      const expectedBuildings = fixture.elements.filter((element) => element.tags?.building).length;
      expect(result.buildingCount).toBe(expectedBuildings);
      expect(result.tris).toBeGreaterThan(0);
      expect(result.walls.length).toBeGreaterThan(0);
      expect(transfers.length).toBeGreaterThan(0);
    }
  });

  it('records the real-city source, ODbL terms and sanitized archive hash', () => {
    const metadata = rome.benchmarkFixture;
    expect(metadata.dataKind).toBe('real-world OpenStreetMap extract');
    expect(metadata.attribution).toBe('© OpenStreetMap contributors');
    expect(metadata.license).toBe('ODbL-1.0');
    expect(metadata.source.provider).toBe('BBBike custom OSM extract service');
    expect(metadata.source.downloadUrl).toContain('download2.bbbike.org/osm/extract/');
    expect(metadata.source.originalDownloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.source.sanitizedArchiveSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.counts.buildings).toBeGreaterThan(100);
    expect(metadata.counts.roads).toBeGreaterThan(500);

    const archivePath = new URL('../benchmarks/fixtures/source/rome-colosseum-2026-10-27.osm.gz', import.meta.url);
    const archive = readFileSync(archivePath);
    const archiveHash = createHash('sha256').update(archive).digest('hex');
    const xml = gunzipSync(archive).toString('utf8');
    expect(archiveHash).toBe(metadata.source.sanitizedArchiveSha256);
    expect(xml).not.toMatch(/<(?:node|way|relation)\b[^>]*\b(?:user|uid|changeset)=/);
    expect(xml).not.toMatch(/<(?:node|way|relation)\b[^>]*\bversion=/);
  });

  it('builds the retained OSM showcase through the production geometry path', async () => {
    const { buildCityGeometry } = await import('../lib/engine/city-builder-core.js');
    const { result, transfers } = buildCityGeometry({
      elements: rome.elements,
      lat0: rome.benchmarkFixture.center.lat,
      lon0: rome.benchmarkFixture.center.lon,
    });
    expect(result.buildingCount).toBe(rome.benchmarkFixture.counts.uniqueBuildingFootprints);
    expect(result.tris).toBeGreaterThan(0);
    expect(result.roadDecals.length).toBeGreaterThan(0);
    expect(transfers.length).toBeGreaterThan(0);
  });
});
