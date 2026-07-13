// Budget-safe R2 city enrichment. Reads selected cached city cells, embeds one
// compact enrichment block, and overwrites the same object (no extra runtime GET).
// Dry-run is the default. Nothing is uploaded unless --upload is present.
//
// Examples:
//   npm run enrich -- --lat=18.9438 --lon=72.8231
//   npm run enrich -- --group="Coasts and islands" --limit=10 --upload
//   npm run enrich -- --key=wtw_city6_18.944_72.823 --sources-dir=data/enrichment
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { PLACES } from "../lib/geo.js";
import { SEED_GROUPS } from "../lib/seedPlaces.js";
import { deriveCellEnrichment } from "../lib/engine/cell-enrichment.js";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const values = (name) => args
  .filter((a) => a.startsWith(`--${name}=`))
  .map((a) => a.slice(name.length + 3).replace(/^"|"$/g, ""));
const value = (name, fallback = "") => values(name).at(-1) || fallback;
const number = (name, fallback) => {
  const n = Number(value(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const UPLOAD = has("--upload");
const LIMIT = Math.min(250, Math.floor(number("limit", 25)));
const MAX_OBJECT = Math.floor(number("max-object-kb", 250) * 1024);
const MAX_TOTAL = Math.floor(number("max-total-mb", 100) * 1024 * 1024);
const SOURCES_DIR = value("sources-dir");
const USE_WIKIDATA = has("--wikidata");
const WIKIDATA_LIMIT = Math.min(40, Math.floor(number("wikidata-limit", 12)));
const USE_OVERTURE = has("--overture");
const WARM_MISSING = has("--warm-missing");
const REFRESH_BASE = has("--refresh-base");
const CACHE_VERSION = 6;
const required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const missing = required.filter((k) => !process.env[k]?.trim());
if (missing.length) throw new Error(`Missing in .env.local: ${missing.join(", ")}`);

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.R2_BUCKET_NAME;
const cityKey = (lat, lon) => `wtw_city${CACHE_VERSION}_${Number(lat).toFixed(3)}_${Number(lon).toFixed(3)}`;
const coordsFromKey = (key) => {
  const m = key.match(/^wtw_city\d+_(-?\d+\.\d{3})_(-?\d+\.\d{3})$/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
};

async function getJson(key) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `${key}.json` }));
    const bytes = Buffer.from(await res.Body.transformToByteArray());
    const text = res.ContentEncoding === "gzip" || (bytes[0] === 0x1f && bytes[1] === 0x8b)
      ? gunzipSync(bytes).toString("utf8")
      : bytes.toString("utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function putJson(key, text, compressed) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${key}.json`,
    Body: compressed,
    ContentType: "application/json",
    ContentEncoding: "gzip",
    Metadata: { "wtw-enrichment": "1" },
  }));
}

async function listCityKeys() {
  const out = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `wtw_city${CACHE_VERSION}_`,
      ContinuationToken: token,
      MaxKeys: 1000,
    }));
    for (const o of res.Contents || []) {
      if (o.Key.endsWith(".json")) out.push(o.Key.slice(0, -5));
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function readSidecar(key) {
  if (!SOURCES_DIR) return {};
  try {
    const text = await readFile(resolve(SOURCES_DIR, `${key}.json`), "utf8");
    const data = JSON.parse(text);
    return {
      sources: Array.isArray(data.sources) ? data.sources : [],
      density: data.density || {},
      patches: data.patches || {},
      landmarks: Array.isArray(data.landmarks) ? data.landmarks : [],
      features: Array.isArray(data.features) ? data.features : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`${key} sidecar: ${error.message}`);
  }
}

const wikidataCache = new Map();
let wikidataReads = 0;
async function wikidataDetails(qid) {
  if (!qid || !/^Q\d+$/.test(qid) || wikidataReads >= WIKIDATA_LIMIT) return null;
  if (wikidataCache.has(qid)) return wikidataCache.get(qid);
  wikidataReads++;
  const res = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
    headers: { "User-Agent": "WalkTheWorld/0.4 (cell enrichment)" },
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const entity = (await res.json()).entities?.[qid];
  const result = entity ? {
    qid,
    label: entity.labels?.en?.value,
    description: entity.descriptions?.en?.value,
  } : null;
  wikidataCache.set(qid, result);
  return result;
}

function mergeExtras(...items) {
  return {
    sources: items.flatMap((x) => x.sources || []),
    density: Object.assign({}, ...items.map((x) => x.density || {})),
    patches: Object.assign({}, ...items.map((x) => x.patches || {})),
    landmarks: items.flatMap((x) => x.landmarks || []),
    features: items.flatMap((x) => x.features || []),
  };
}

async function selectKeys() {
  const selected = new Set(values("key").map((k) => k.replace(/\.json$/, "")));
  const latRaw = value("lat");
  const lonRaw = value("lon");
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (latRaw !== "" && lonRaw !== "" && Number.isFinite(lat) && Number.isFinite(lon)) {
    selected.add(cityKey(lat, lon));
  }

  const group = value("group");
  if (group) {
    const groups = { "Fast travel": PLACES, ...SEED_GROUPS };
    const places = groups[group];
    if (!places) throw new Error(`Unknown group '${group}'. Available: ${Object.keys(groups).join(", ")}`);
    for (const p of places) selected.add(cityKey(p.lat, p.lon));
  }
  if (has("--all-cached")) {
    if (!values("limit").length) throw new Error("--all-cached requires an explicit --limit=N safety cap");
    for (const key of await listCityKeys()) selected.add(key);
  }
  return [...selected].slice(0, LIMIT);
}

const keys = await selectKeys();
if (!keys.length) {
  console.log("No cells selected. Use --lat=.. --lon=.., --key=.., --group=.., or --all-cached --limit=N.");
  process.exit(1);
}

console.log(`${UPLOAD ? "UPLOAD" : "DRY RUN"}: ${keys.length} cell(s), max object ${MAX_OBJECT / 1024} KB, max total ${(MAX_TOTAL / 1048576).toFixed(0)} MB`);
let totalBytes = 0;
let ready = 0;
for (const key of keys) {
  const coords = coordsFromKey(key);
  if (!coords) { console.warn(`skip ${key}: invalid city key`); continue; }
  let city = await getJson(key);
  if (REFRESH_BASE || (!city?.elements?.length && WARM_MISSING)) {
    console.log(`fetch ${key}: ${REFRESH_BASE ? "refreshing" : "base cell missing"}, querying Overpass once`);
    try {
      const { fetchOverpassCell } = await import("../lib/overpassServer.js");
      city = await fetchOverpassCell(coords.lat, coords.lon);
    } catch (error) {
      console.warn(`skip ${key}: base fetch failed (${error.message})`);
      continue;
    }
  }
  if (!city?.elements?.length) { console.warn(`skip ${key}: not present in R2`); continue; }

  const sidecar = await readSidecar(key);
  const extra = mergeExtras(sidecar);

  if (USE_OVERTURE && city.elements.filter((e) => e.tags?.building).length < 120) {
    try {
      const { queryBuildings } = await import("../lib/overtureServer.js");
      const d = 0.007;
      const result = await queryBuildings(coords.lat - d, coords.lat + d, coords.lon - d, coords.lon + d);
      if (result.status === "ok") {
        extra.sources.push("overture");
        extra.features.push(...result.buildings.slice(0, 250).map((b) => ({
          kind: "building", source: "overture", geometry: b.ring,
          properties: { tags: { building: "yes", height: String(b.h) } },
        })));
      }
    } catch (error) {
      console.warn(`  overture unavailable: ${error.message}`);
    }
  }

  const enrichment = deriveCellEnrichment(city, extra);
  if (USE_WIKIDATA) {
    for (const landmark of enrichment.landmarks) {
      const details = await wikidataDetails(landmark.tags?.wikidata);
      if (details) landmark.wikidata = details;
    }
    if (wikidataReads) enrichment.sources.push("wikidata");
  }

  const body = JSON.stringify({ ...city, enrichment });
  const compressed = gzipSync(Buffer.from(body));
  if (compressed.length > MAX_OBJECT) {
    console.warn(`skip ${key}: ${(compressed.length / 1024).toFixed(1)} KB exceeds object cap`);
    continue;
  }
  if (totalBytes + compressed.length > MAX_TOTAL) {
    console.warn("stopped: total upload budget reached");
    break;
  }
  totalBytes += compressed.length;
  ready++;
  console.log(`${UPLOAD ? "upload" : "would upload"} ${key}: ${(compressed.length / 1024).toFixed(1)} KB, ${enrichment.features.length} source features, urban ${enrichment.density.urban}`);
  if (UPLOAD) await putJson(key, body, compressed);
}

console.log(`${UPLOAD ? "Uploaded" : "Ready"}: ${ready}/${keys.length} cells, ${(totalBytes / 1048576).toFixed(2)} MB compressed. ${UPLOAD ? "" : "Re-run with --upload after reviewing this estimate."}`);
