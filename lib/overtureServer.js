// Server-only Overture Maps buildings via DuckDB over S3 GeoParquet.
// DuckDB is dynamically imported so `next dev` doesn't load the native
// binary during startup — only when an Overture API route is actually hit.

import { isConfigured, downloadObject, uploadObject } from "@/lib/r2Server";

const RELEASE = process.env.OVERTURE_RELEASE || "2026-06-17.0";
const MANIFEST_KEY = `wtw_ovt_manifest_${RELEASE}.json`;

let connPromise = null;
function getConn() {
  if (!connPromise) {
    connPromise = (async () => {
      const duckdb = (await import("duckdb")).default;
      const db = new duckdb.Database(":memory:");
      const conn = db.connect();
      await new Promise((resolve, reject) => {
        conn.exec(
          "INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';",
          (e) => (e ? reject(e) : resolve())
        );
      });
      return conn;
    })();
  }
  return connPromise;
}
const q = (conn, sql) =>
  new Promise((res, rej) => conn.all(sql, (e, r) => (e ? rej(e) : res(r))));

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
  const { buildOvertureManifest } = await import("@/lib/overtureManifestBuild.mjs");
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
            COALESCE(height, num_floors * 3.2, 8) AS h
     FROM read_parquet([${files.join(",")}])
     WHERE bbox.xmin < ${lonMax} AND bbox.xmax > ${lonMin}
       AND bbox.ymin < ${latMax} AND bbox.ymax > ${latMin}
     LIMIT 3000`
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
      if (ring && ring.length >= 4) buildings.push({ ring, h: Math.round(r.h * 10) / 10 });
    } catch {
      /* skip bad geometry */
    }
  }
  return { status: "ok", buildings };
}
