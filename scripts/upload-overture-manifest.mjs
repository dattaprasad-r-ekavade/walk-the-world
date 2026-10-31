// Publish the reviewed Overture manifest after separate approval.
// Dry-run is the default and performs no R2 request. Writes require --apply
// and the exact minified-body SHA-256 printed by dry-run.
//
//   node --env-file=.env.local scripts/upload-overture-manifest.mjs \
//     --manifest=benchmarks/results/stage0/sec1-overture-index-2026-10-31.json
//   node --env-file=.env.local scripts/upload-overture-manifest.mjs \
//     --manifest=<path> --apply --body-sha256=<sha256>

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { cityCacheKey, cellNeighborhood, parseCityKey } from "../lib/city-contract.js";
import { DEMO_PLACES } from "../lib/geo.js";
import { downloadObject, isConfigured } from "../lib/r2Server.js";

const args = process.argv.slice(2);
const option = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/"/g, "") : null;
};
const APPLY = args.includes("--apply");
const MANIFEST_ARG = option("manifest");
const APPROVED_BODY_SHA256 = option("body-sha256")?.toLowerCase() || "";
const RELEASE = process.env.OVERTURE_RELEASE || "2026-10-21.0";
const MANIFEST_PREFIX = `s3://overturemaps-us-west-2/release/${RELEASE}/theme=buildings/type=building/`;
const MANIFEST_KEY = `wtw_ovt_manifest_${RELEASE}.json`;
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function usage() {
  console.log(
    "Usage: node --env-file=.env.local scripts/upload-overture-manifest.mjs " +
    "--manifest=<reviewed-json> [--apply --body-sha256=<sha256>]\n" +
    "Without --apply, validates the local manifest and prints the exact R2 body hash without contacting R2.\n" +
    "Writes require the exact body hash, configured R2 credentials, and an empty or identical release key."
  );
}

function loadManifest() {
  if (!MANIFEST_ARG) throw new Error("Pass --manifest=<reviewed manifest path>");
  const filePath = path.resolve(MANIFEST_ARG);
  const prettyText = readFileSync(filePath, "utf8");
  const manifest = JSON.parse(prettyText);
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("Manifest must be a non-empty array");

  const files = new Set();
  for (const [index, entry] of manifest.entries()) {
    if (!Array.isArray(entry) || entry.length !== 5) throw new Error(`Manifest row ${index} must have five fields`);
    const [file, xmin, xmax, ymin, ymax] = entry;
    if (typeof file !== "string" || !file.startsWith(MANIFEST_PREFIX)) {
      throw new Error(`Manifest row ${index} does not belong to Overture release ${RELEASE}`);
    }
    if (files.has(file)) throw new Error(`Duplicate Parquet file in manifest: ${file}`);
    files.add(file);
    if (![xmin, xmax, ymin, ymax].every(Number.isFinite)
      || xmin < -180 || xmax > 180 || ymin < -90 || ymax > 90
      || xmin > xmax || ymin > ymax) {
      throw new Error(`Manifest row ${index} has invalid bounds`);
    }
  }

  const cells = new Map();
  for (const place of DEMO_PLACES) {
    for (const [lat, lon] of cellNeighborhood(place.lat, place.lon)) {
      const key = cityCacheKey(lat, lon);
      if (!cells.has(key)) cells.set(key, place.name);
    }
  }
  const coverage = [];
  for (const [key, place] of cells) {
    const { lat, lon } = parseCityKey(key);
    const dLat = 0.006;
    const dLon = 0.006 / Math.cos((lat * Math.PI) / 180);
    const count = manifest.filter(([, xmin, xmax, ymin, ymax]) =>
      xmin < lon + dLon && xmax > lon - dLon && ymin < lat + dLat && ymax > lat - dLat
    ).length;
    if (!count) throw new Error(`${place} cell ${key} has no intersecting manifest file`);
    coverage.push({ key, place, parquetFiles: count });
  }
  if (coverage.length !== 36) {
    throw new Error(`Expected 36 Demo cells, found ${coverage.length}`);
  }

  const body = JSON.stringify(manifest);
  return {
    filePath,
    prettySha256: sha256(prettyText),
    body,
    bodyBytes: Buffer.byteLength(body, "utf8"),
    bodySha256: sha256(body),
    manifest,
    coverage,
  };
}

async function publish(review) {
  if (!APPROVED_BODY_SHA256 || APPROVED_BODY_SHA256 !== review.bodySha256) {
    throw new Error(`--apply requires --body-sha256=${review.bodySha256}`);
  }
  if (!isConfigured()) throw new Error("Missing R2_* configuration in .env.local; no R2 request was made");

  const currentText = await downloadObject(MANIFEST_KEY);
  if (currentText !== null) {
    if (sha256(currentText) === review.bodySha256) {
      console.log(`${MANIFEST_KEY} already contains the reviewed manifest; no upload was needed.`);
      return;
    }
    throw new Error(`${MANIFEST_KEY} already exists with different content; refusing to overwrite it`);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  try {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: MANIFEST_KEY,
      Body: review.body,
      ContentType: "application/json",
    }));
    const uploadedText = await downloadObject(MANIFEST_KEY);
    if (uploadedText === null || sha256(uploadedText) !== review.bodySha256) {
      throw new Error("R2 read-back does not match the approved manifest body");
    }
    console.log(`Published ${MANIFEST_KEY} (${review.manifest.length} files); read-back hash verified.`);
  } catch (error) {
    let cleanup = "cleanup not confirmed";
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: MANIFEST_KEY }));
      const remaining = await downloadObject(MANIFEST_KEY);
      cleanup = remaining === null ? "new manifest object removed" : "manifest object still exists after delete";
    } catch (cleanupError) {
      cleanup = `delete/read-back failed: ${cleanupError?.message || cleanupError}`;
    }
    throw new Error(`Manifest publish failed (${error?.message || error}); ${cleanup}`);
  } finally {
    s3.destroy();
  }
}

async function main() {
  if (args.includes("--help") || args.includes("-h")) return usage();
  const supported = new Set(["--manifest", "--body-sha256"]);
  for (const arg of args) {
    if (arg === "--apply") continue;
    if (!arg.startsWith("--") || !supported.has(arg.slice(0, arg.indexOf("=")))) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }

  const review = loadManifest();
  console.log(`Release: ${RELEASE}`);
  console.log(`Destination key: ${MANIFEST_KEY}`);
  console.log(`Files: ${review.manifest.length}; Demo cells covered: ${review.coverage.length}/36`);
  console.log(`Local manifest SHA-256: ${review.prettySha256}`);
  console.log(`Upload body: ${review.bodyBytes} bytes; SHA-256 ${review.bodySha256}`);
  const byCity = Object.groupBy(review.coverage, (cell) => cell.place);
  for (const [place, cells] of Object.entries(byCity)) {
    const counts = cells.map((cell) => cell.parquetFiles);
    console.log(`  ${place}: ${cells.length} cells; ${Math.min(...counts)}–${Math.max(...counts)} intersecting files per cell`);
  }

  if (!APPLY) {
    console.log("Dry run only: no R2 request or write was made. Pass --apply and the exact body hash after approval.");
    return;
  }
  await publish(review);
}

main().catch((error) => {
  console.error(`[upload-overture-manifest] ${error?.message || error}`);
  process.exitCode = 1;
});
