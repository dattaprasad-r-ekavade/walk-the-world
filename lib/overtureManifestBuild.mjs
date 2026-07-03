// Shared Overture manifest builder: lists parquet files on S3, reads footers
// in batches (fast + progress), returns [[file, xmin, xmax, ymin, ymax], ...].

import duckdb from "duckdb";

const DEFAULT_RELEASE = "2026-06-17.0";
const BATCH_SIZE = 25;

function openConn() {
  const db = new duckdb.Database(":memory:");
  const conn = db.connect();
  const q = (sql) =>
    new Promise((res, rej) => conn.all(sql, (e, r) => (e ? rej(e) : res(r))));
  return { db, conn, q };
}

const METADATA_SQL = (fileList) => `
  SELECT file_name,
    MIN(TRY_CAST(stats_min_value AS DOUBLE)) FILTER (path_in_schema = 'bbox, xmin') AS xmin,
    MAX(TRY_CAST(stats_max_value AS DOUBLE)) FILTER (path_in_schema = 'bbox, xmax') AS xmax,
    MIN(TRY_CAST(stats_min_value AS DOUBLE)) FILTER (path_in_schema = 'bbox, ymin') AS ymin,
    MAX(TRY_CAST(stats_max_value AS DOUBLE)) FILTER (path_in_schema = 'bbox, ymax') AS ymax
  FROM parquet_metadata([${fileList}])
  WHERE path_in_schema LIKE 'bbox,%'
  GROUP BY file_name`;

export async function buildOvertureManifest({ release, onProgress } = {}) {
  const rel = release || process.env.OVERTURE_RELEASE || DEFAULT_RELEASE;
  const base = `s3://overturemaps-us-west-2/release/${rel}/theme=buildings/type=building`;
  const { db, conn, q } = openConn();

  try {
    onProgress?.({ stage: "init", pct: 0, detail: "Loading DuckDB httpfs…" });
    await q(
      "INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads TO 4;"
    );

    onProgress?.({ stage: "list", pct: 2, detail: "Listing parquet files on S3…" });
    const listed = await q(`SELECT file FROM glob('${base}/*.parquet')`);
    const files = listed.map((r) => r.file);
    if (!files.length) {
      throw new Error(`No parquet files found for release ${rel}`);
    }

    const manifest = [];
    const total = files.length;
    const t0 = Date.now();

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const fileList = batch.map((f) => `'${f}'`).join(",");
      const rows = await q(METADATA_SQL(fileList));
      for (const r of rows) {
        if (r.xmin !== null) {
          manifest.push([r.file_name, r.xmin, r.xmax, r.ymin, r.ymax]);
        }
      }
      const done = Math.min(i + BATCH_SIZE, total);
      const elapsed = Math.round((Date.now() - t0) / 1000);
      const eta =
        done > 0 ? Math.round((elapsed / done) * (total - done)) : "?";
      onProgress?.({
        stage: "scan",
        pct: Math.round(5 + (done / total) * 90),
        detail: `Footer scan ${done}/${total} (${elapsed}s elapsed, ~${eta}s left)`,
        done,
        total,
      });
    }

    onProgress?.({
      stage: "done",
      pct: 100,
      detail: `Indexed ${manifest.length} files in ${Math.round((Date.now() - t0) / 1000)}s`,
    });
    return { release: rel, manifest, fileCount: manifest.length };
  } finally {
    conn.close();
    db.close();
  }
}
