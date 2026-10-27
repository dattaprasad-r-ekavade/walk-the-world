#!/usr/bin/env node
/** Regenerate deterministic, synthetic city-shape fixtures used by local benches. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'benchmarks', 'fixtures');
const CENTER = { lat: 41.8902, lon: 12.4922 };
const METERS_PER_DEGREE = 111_320;

function toGeo(east, north) {
  return {
    lat: CENTER.lat + north / METERS_PER_DEGREE,
    lon: CENTER.lon + east / (METERS_PER_DEGREE * Math.cos(CENTER.lat * Math.PI / 180)),
  };
}

function way(id, tags, points) {
  return { type: 'way', id, tags, geometry: points.map(([east, north]) => toGeo(east, north)) };
}

function rectangle(id, x, z, width, depth, tags) {
  const halfW = width / 2;
  const halfD = depth / 2;
  return way(id, tags, [
    [x - halfW, z - halfD],
    [x + halfW, z - halfD],
    [x + halfW, z + halfD],
    [x - halfW, z + halfD],
  ]);
}

function makeCityFixture({ id, title, columns, rows, pitch, start, buildingSize, roadEvery }) {
  const elements = [];
  let nextId = 10_000;
  let buildingCount = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = start + column * pitch;
      const z = start + row * pitch;
      const width = buildingSize[0] + ((column * 7 + row * 3) % Math.max(1, buildingSize[1] - buildingSize[0] + 1));
      const depth = buildingSize[0] + ((column * 5 + row * 11 + 2) % Math.max(1, buildingSize[1] - buildingSize[0] + 1));
      const kind = ['apartments', 'commercial', 'residential', 'civic'][buildingCount % 4];
      elements.push(rectangle(nextId++, x, z, width, depth, {
        building: kind,
        'building:levels': String(2 + ((column * 2 + row) % 9)),
        ...(buildingCount % 9 === 0 ? { name: `Synthetic block ${buildingCount + 1}` } : {}),
      }));
      buildingCount++;
    }
  }

  for (let row = 0; row <= rows; row += roadEvery) {
    const z = start - pitch / 2 + row * pitch;
    elements.push(way(nextId++, { highway: row === 0 ? 'primary' : 'residential', name: `Synthetic avenue ${row + 1}` }, [
      [start - pitch, z],
      [start + (columns - 1) * pitch + pitch, z],
    ]));
  }
  for (let column = 0; column <= columns; column += Math.max(2, roadEvery)) {
    const x = start - pitch / 2 + column * pitch;
    elements.push(way(nextId++, { highway: 'residential' }, [
      [x, start - pitch],
      [x, start + (rows - 1) * pitch + pitch],
    ]));
  }

  const parkCenter = start + pitch * Math.floor(rows / 2);
  elements.push(way(nextId++, { leisure: 'park', name: 'Synthetic green' }, [
    [start - 12, parkCenter - 8],
    [start + 10, parkCenter - 9],
    [start + 14, parkCenter + 11],
    [start - 9, parkCenter + 13],
  ]));
  elements.push({ type: 'node', id: nextId++, ...toGeo(start, start), tags: { amenity: 'bench' } });
  elements.push({ type: 'node', id: nextId++, ...toGeo(start + pitch, start), tags: { highway: 'street_lamp' } });
  elements.push({ type: 'node', id: nextId++, ...toGeo(start - pitch, start + pitch), tags: { highway: 'traffic_signals' } });

  return {
    benchmarkFixture: {
      id,
      title,
      dataKind: 'synthetic city-shaped benchmark data; not a real-world map extract',
      provenance: 'Generated deterministically by scripts/build-benchmark-fixtures.mjs',
      license: 'CC0-1.0',
      center: CENTER,
      featureCounts: {
        buildings: buildingCount,
        roads: elements.filter((element) => element.type === 'way' && element.tags?.highway).length,
        parks: elements.filter((element) => element.tags?.leisure === 'park').length,
      },
    },
    elements,
  };
}

function makeDifficultPolygons() {
  const elements = [];
  let nextId = 90_000;
  const rings = [
    { center: [-55, -20], points: [[-25, -22], [28, -22], [28, -12], [-10, -12], [-10, 12], [28, 12], [28, 22], [-25, 22]] },
    { center: [45, -22], points: null },
    { center: [-25, 55], points: [[-30, -26], [20, -26], [20, -18], [-17, -18], [-17, -8], [24, -8], [24, 0], [-17, 0], [-17, 10], [20, 10], [20, 18], [-30, 18]] },
  ];

  for (const entry of rings) {
    const points = entry.points || Array.from({ length: 96 }, (_, index) => {
      const angle = (index / 96) * Math.PI * 2;
      const radius = 27 + 7 * Math.sin(angle * 5) + 3.5 * Math.sin(angle * 13);
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    });
    elements.push(way(nextId++, {
      building: 'industrial',
      height: '18',
      name: `Synthetic complex ${nextId - 90_001}`,
    }, points.map(([east, north]) => [east + entry.center[0], north + entry.center[1]])));
  }
  elements.push(way(nextId++, { highway: 'residential' }, [[-120, 0], [120, 0]]));
  return {
    benchmarkFixture: {
      id: 'synthetic-difficult-polygons',
      title: 'Concave and high-vertex polygon stress case',
      dataKind: 'synthetic geometry stress data; not a real-world map extract',
      provenance: 'Generated deterministically by scripts/build-benchmark-fixtures.mjs',
      license: 'CC0-1.0',
      center: CENTER,
      polygonVertexCounts: elements.filter((element) => element.tags?.building).map((element) => element.geometry.length),
    },
    elements,
  };
}

function makePropHeavyFixture() {
  const propTags = [
    { highway: 'traffic_signals' },
    { highway: 'bus_stop' },
    { amenity: 'fountain' },
    { amenity: 'vending_machine' },
    { man_made: 'chimney' },
    { man_made: 'lighthouse' },
    { man_made: 'crane' },
    { railway: 'subway_entrance' },
  ];
  const elements = [];
  let nextId = 100_000;
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      const east = (column - 7.5) * 13;
      const north = (row - 7.5) * 13;
      elements.push({
        type: 'node',
        id: nextId,
        ...toGeo(east, north),
        tags: propTags[(row * 16 + column) % propTags.length],
      });
      nextId++;
    }
  }
  elements.push(way(nextId++, { highway: 'residential', name: 'Synthetic prop test road' }, [
    [-130, -112],
    [130, -112],
  ]));
  return {
    benchmarkFixture: {
      id: 'synthetic-prop-heavy',
      title: 'Repeated static props for material-batching comparison',
      dataKind: 'synthetic prop-focused benchmark data; not a real-world map extract',
      provenance: 'Generated deterministically by scripts/build-benchmark-fixtures.mjs',
      license: 'CC0-1.0',
      center: CENTER,
      featureCounts: { staticProps: 256, roads: 1, propKinds: propTags.length },
    },
    elements,
  };
}

const fixtures = [
  ['synthetic-showcase.json', makeCityFixture({ id: 'synthetic-showcase', title: 'Feature-rich synthetic downtown', columns: 8, rows: 7, pitch: 42, start: -126, buildingSize: [14, 28], roadEvery: 3 })],
  ['synthetic-dense.json', makeCityFixture({ id: 'synthetic-dense', title: 'High building and road density', columns: 12, rows: 10, pitch: 22, start: -121, buildingSize: [9, 17], roadEvery: 2 })],
  ['synthetic-sparse.json', makeCityFixture({ id: 'synthetic-sparse', title: 'Low building density with long streets', columns: 4, rows: 3, pitch: 78, start: -117, buildingSize: [16, 30], roadEvery: 1 })],
  ['synthetic-difficult-polygons.json', makeDifficultPolygons()],
  ['synthetic-prop-heavy.json', makePropHeavyFixture()],
];

mkdirSync(FIXTURES, { recursive: true });
for (const [filename, data] of fixtures) {
  const path = join(FIXTURES, filename);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`${filename}: ${data.elements.length} elements`);
}
