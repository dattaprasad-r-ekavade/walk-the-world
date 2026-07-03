// ONE-TIME Overture file-index build. Run locally:
//   npm run overture-index
// Lists 512 parquet files, reads footers in batches (~15–25 min), uploads
// manifest JSON to R2. Progress prints every batch so it doesn't look hung.
import { config } from "dotenv";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { buildOvertureManifest } from "../lib/overtureManifestBuild.mjs";

config({ path: ".env.local" });

const required = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
const missing = required.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.error(`[overture-index] Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}

const RELEASE = process.env.OVERTURE_RELEASE || "2026-06-17.0";
console.log(`[overture-index] Release ${RELEASE} — expect ~15–25 min for 512 files.`);

const { manifest } = await buildOvertureManifest({
  release: RELEASE,
  onProgress: ({ detail, pct }) => console.log(`[overture-index] ${pct}% — ${detail}`),
});

console.log(`[overture-index] Uploading manifest (${manifest.length} files) to R2…`);

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const key = `wtw_ovt_manifest_${RELEASE}.json`;
await s3.send(
  new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(manifest),
    ContentType: "application/json",
  })
);

console.log(`[overture-index] Done — uploaded ${key}. Overture fallback is live.`);
process.exit(0);
