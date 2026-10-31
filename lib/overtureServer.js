// Server-only Overture Maps buildings via DuckDB over S3 GeoParquet.
// DuckDB is dynamically imported so `next dev` doesn't load the native
// binary during startup — only when an Overture API route is actually hit.

import { isConfigured, downloadObject, uploadObject } from "./r2Server.js";

const RELEASE = process.env.OVERTURE_RELEASE || "2026-10-21.0";
const MANIFEST_KEY = `wtw_ovt_manifest_${RELEASE}.json`;
const BUILDING_QUERY_LIMIT = 5_000;

let connPromise = null;
function getConn() {
  if (!connPromise) {
    connPromise = (async () => {
      const { DuckDBInstance } = await import("@duckdb/node-api");
      const db = await DuckDBInstance.create(":memory:");
      const conn = await db.connect();
      await conn.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';");
      return conn;
    })();
    // Let a failed start (e.g. extension download) be retried by the next request.
    connPromise.catch(() => { connPromise = null; });
  }
  return connPromise;
}
const q = async (conn, sql) => (await conn.runAndReadAll(sql)).getRowObjectsJS();

function openStreetMapWayIds(sourcesJson) {
  let sources = sourcesJson;
  if (typeof sourcesJson === "string") {
    try { sources = JSON.parse(sourcesJson); } catch { return []; }
  }
  if (!Array.isArray(sources)) return [];
  return [...new Set(sources
    .filter((source) => String(source?.dataset || "").toLowerCase() === "openstreetmap")
    .map((source) => /^w(\d+)(?:@\d+)?$/u.exec(String(source?.record_id || ""))?.[1])
    .filter(Boolean)
    .map(Number)
    .filter(Number.isSafeInteger))];
}

let manifestCache = null;
export async function getManifest() {
  if (manifestCache) return manifestCache;
  if (isConfigured()) {
    const text = await downloadObject(MANIFEST_KEY).catch(() => null);
    if (text) {
      manifestCache = JSON.parse(text);
      return manifestCache;
    }
  }
  return null;
}

export async function buildManifest() {
  const { buildOvertureManifest } = await import("./overtureManifestBuild.mjs");
  const { manifest } = await buildOvertureManifest({
    onProgress: ({ detail, done, total }) => {
      if (done && total) console.log(`[overture-index] ${done}/${total} — ${detail}`);
    },
  });
  manifestCache = manifest;
  if (isConfigured()) await uploadObject(MANIFEST_KEY, JSON.stringify(manifest));
  return manifest.length;
}

export async function queryBuildings(latMin, latMax, lonMin, lonMax) {
  const manifest = await getManifest();
  if (!manifest) return { status: "no-index" };
  const files = manifest
    .filter(([, x0, x1, y0, y1]) => x0 < lonMax && x1 > lonMin && y0 < latMax && y1 > latMin)
    .map(([f]) => `'${f}'`);
  if (!files.length) return { status: "ok", buildings: [] };
  const conn = await getConn();
  const rows = await q(
    conn,
    `SELECT ST_AsGeoJSON(geometry) AS geo,
            COALESCE(height, num_floors * 3.2, 8) AS h,
            height AS overture_height, num_floors, roof_shape, roof_color,
            facade_color, facade_material, CAST(to_json(sources) AS VARCHAR) AS sources_json
     FROM read_parquet([${files.join(",")}])
     WHERE bbox.xmin < ${lonMax} AND bbox.xmax > ${lonMin}
       AND bbox.ymin < ${latMax} AND bbox.ymax > ${latMin}
     LIMIT ${BUILDING_QUERY_LIMIT}`
  );
  const buildings = [];
  for (const r of rows) {
    try {
      const g = JSON.parse(r.geo);
      const ring =
        g.type === "Polygon"
          ? g.coordinates[0]
          : g.type === "MultiPolygon"
            ? g.coordinates[0][0]
            : null;
      if (ring && ring.length >= 4) buildings.push({
        ring,
        h: Math.round(r.h * 10) / 10,
        osmWayIds: openStreetMapWayIds(r.sources_json),
        height: r.overture_height,
        numFloors: r.num_floors,
        roofShape: r.roof_shape,
        roofColor: r.roof_color,
        facadeColor: r.facade_color,
        facadeMaterial: r.facade_material,
      });
    } catch {
      /* skip bad geometry */
    }
  }
  return { status: "ok", buildings };
}
