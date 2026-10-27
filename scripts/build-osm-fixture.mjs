#!/usr/bin/env node
/** Convert the dated BBBike Rome OSM extract to the engine's fixture schema. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'benchmarks', 'fixtures', 'source', 'rome-colosseum-2026-10-27.osm.gz');
const PROVENANCE = join(ROOT, 'benchmarks', 'fixtures', 'source', 'rome-colosseum-2026-10-27.provenance.json');
const OUTPUT = join(ROOT, 'benchmarks', 'fixtures', 'rome-showcase-osm.json');
const DOWNLOAD_URL = 'https://download2.bbbike.org/osm/extract/planet_12.48799,41.88676_12.49701,41.89424.osm.gz';
const BBOX = [12.48799, 41.88676, 12.49701, 41.89424]; // west, south, east, north
const CENTER = { lat: 41.8902, lon: 12.4922 };
const LOCAL_METERS_PER_DEGREE = (Math.PI * 6_378_137) / 180;
const REMOVED_METADATA = ['version', 'timestamp', 'uid', 'user', 'changeset'];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function unescapeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    if (code === 'amp') return '&';
    if (code === 'lt') return '<';
    if (code === 'gt') return '>';
    if (code === 'quot') return '"';
    if (code === 'apos') return "'";
    const number = code[1]?.toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
  });
}

function attributes(text) {
  return Object.fromEntries([...text.matchAll(/([\w:.-]+)="([^"]*)"/g)]
    .map((match) => [match[1], unescapeXml(match[2])]));
}

function sanitizeXml(xml) {
  return xml.replace(/<(node|way|relation)\b[^>]*>/g, (tag) => {
    let clean = tag;
    for (const name of REMOVED_METADATA) {
      clean = clean.replace(new RegExp(`\\s${name}="[^"]*"`, 'g'), '');
    }
    return clean;
  });
}

function parseOsm(xml) {
  const nodes = new Map();
  const ways = [];
  const taggedNodes = [];
  let sourceNodeCount = 0;
  let sourceWayCount = 0;
  let sourceRelationCount = 0;

  const records = /<(node|way|relation)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g;
  for (const match of xml.matchAll(records)) {
    const [, type, attributeText, body = ''] = match;
    const attrs = attributes(attributeText);
    if (!Number.isSafeInteger(Number(attrs.id))) continue;
    if (type === 'relation') {
      sourceRelationCount++;
      continue; // The current production builder consumes way and node elements.
    }
    const tags = Object.fromEntries([...body.matchAll(/<tag\b([^>]*?)\/>/g)]
      .map((tag) => {
        const values = attributes(tag[1]);
        return [values.k, values.v];
      })
      .filter(([key]) => key));

    if (type === 'node') {
      sourceNodeCount++;
      const point = { lat: Number(attrs.lat), lon: Number(attrs.lon) };
      nodes.set(Number(attrs.id), point);
      if (Object.keys(tags).length && Number.isFinite(point.lat) && Number.isFinite(point.lon)) {
        taggedNodes.push({ type, id: Number(attrs.id), ...point, tags });
      }
      continue;
    }

    sourceWayCount++;
    const refs = [...body.matchAll(/<nd\b([^>]*?)\/>/g)]
      .map((nd) => Number(attributes(nd[1]).ref));
    ways.push({ id: Number(attrs.id), tags, refs });
  }

  const elements = [...taggedNodes];
  let incompleteWays = 0;
  for (const way of ways) {
    if (!Object.keys(way.tags).length) continue;
    const geometry = way.refs.map((ref) => nodes.get(ref));
    if (!geometry.length || geometry.some((point) => !point)) {
      incompleteWays++;
      continue;
    }
    elements.push({ type: 'way', id: way.id, tags: way.tags, geometry });
  }

  return {
    elements,
    sourceCounts: { nodes: sourceNodeCount, ways: sourceWayCount, relations: sourceRelationCount },
    omittedIncompleteWays: incompleteWays,
  };
}

if (!existsSync(SOURCE)) {
  throw new Error(`Missing OSM source archive: ${SOURCE}`);
}

mkdirSync(dirname(PROVENANCE), { recursive: true });
const downloadedBytes = readFileSync(SOURCE);
let provenance = existsSync(PROVENANCE)
  ? JSON.parse(readFileSync(PROVENANCE, 'utf8'))
  : {
      provider: 'BBBike custom OSM extract service',
      providerJobName: 'WalkTheWorldRomeShowcase',
      downloadUrl: DOWNLOAD_URL,
      downloadedAt: new Date().toISOString(),
      providerFileLastModified: '2026-10-27T09:22:43Z',
      format: 'OSM XML gzip',
      bbox: BBOX,
      bboxOrder: 'west, south, east, north',
      attribution: '© OpenStreetMap contributors',
      license: 'ODbL-1.0',
      licenseUrl: 'https://www.openstreetmap.org/copyright',
      originalDownloadSha256: sha256(downloadedBytes),
    };

let xml = gunzipSync(downloadedBytes).toString('utf8');
const sanitizedXml = sanitizeXml(xml);
const sanitizedBytes = gzipSync(Buffer.from(sanitizedXml, 'utf8'), { level: 9, mtime: 0 });
const sanitizedSha = sha256(sanitizedBytes);
if (sanitizedSha !== sha256(downloadedBytes)) {
  writeFileSync(SOURCE, sanitizedBytes);
  provenance.contributorMetadataRemoved = REMOVED_METADATA;
  provenance.sanitizedArchiveSha256 = sanitizedSha;
  provenance.sanitizedAt = new Date().toISOString();
  writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  xml = sanitizedXml;
} else {
  provenance.sanitizedArchiveSha256 ||= sanitizedSha;
  provenance.contributorMetadataRemoved ||= REMOVED_METADATA;
  writeFileSync(PROVENANCE, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
}

const parsed = parseOsm(xml);
const counts = {
  elements: parsed.elements.length,
  taggedNodes: parsed.elements.filter((element) => element.type === 'node').length,
  ways: parsed.elements.filter((element) => element.type === 'way').length,
  buildings: parsed.elements.filter((element) => element.type === 'way' && element.tags?.building).length,
  buildingTaggedNodes: parsed.elements.filter((element) => element.type === 'node' && element.tags?.building).length,
  uniqueBuildingFootprints: new Set(parsed.elements
    .filter((element) => element.type === 'way' && element.tags?.building)
    .map((element) => {
      const first = element.geometry[0];
      const x = (first.lon - CENTER.lon) * LOCAL_METERS_PER_DEGREE * Math.cos((CENTER.lat * Math.PI) / 180);
      const z = -((first.lat - CENTER.lat) * LOCAL_METERS_PER_DEGREE);
      return `${x.toFixed(1)},${z.toFixed(1)},${element.geometry.length}`;
    })).size,
  roads: parsed.elements.filter((element) => element.type === 'way' && element.tags?.highway).length,
  highwayTaggedNodes: parsed.elements.filter((element) => element.type === 'node' && element.tags?.highway).length,
  greenAndWaterFeatures: parsed.elements.filter((element) => element.tags?.leisure || element.tags?.landuse || element.tags?.natural || element.tags?.waterway).length,
};
const fixture = {
  benchmarkFixture: {
    id: 'rome-showcase-osm',
    title: 'OpenStreetMap Rome Colosseum-area showcase',
    dataKind: 'real-world OpenStreetMap extract',
    provenance: 'BBBike custom extract from OpenStreetMap; converted by scripts/build-osm-fixture.mjs',
    source: {
      provider: provenance.provider,
      providerJobName: provenance.providerJobName,
      downloadUrl: provenance.downloadUrl,
      downloadedAt: provenance.downloadedAt,
      providerFileLastModified: provenance.providerFileLastModified,
      originalDownloadSha256: provenance.originalDownloadSha256,
      sanitizedArchiveSha256: sha256(readFileSync(SOURCE)),
      sourceArchive: 'source/rome-colosseum-2026-10-27.osm.gz',
      bbox: BBOX,
      bboxOrder: 'west, south, east, north',
      format: provenance.format,
      sourceCounts: parsed.sourceCounts,
      omittedIncompleteWays: parsed.omittedIncompleteWays,
      excludedData: 'OSM user/account metadata removed from retained source archive; untagged nodes and relations are not passed to the production way/node builder.',
    },
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL-1.0',
    licenseUrl: 'https://www.openstreetmap.org/copyright',
    center: CENTER,
    counts,
  },
  elements: parsed.elements,
};
writeFileSync(OUTPUT, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
console.log(`${OUTPUT}: ${counts.elements} tagged elements, ${counts.buildings} building ways (${counts.uniqueBuildingFootprints} unique footprints), ${counts.roads} highway ways`);
console.log(`Source archive sanitized; SHA-256 ${fixture.benchmarkFixture.source.sanitizedArchiveSha256}`);
