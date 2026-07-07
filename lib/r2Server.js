// Server-only Cloudflare R2 client (S3-compatible API via @aws-sdk/client-s3).
//
// Required env vars in .env.local (server-side only, never NEXT_PUBLIC_):
//   R2_ENDPOINT           — https://<account_id>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID      — R2 API token access key
//   R2_SECRET_ACCESS_KEY  — R2 API token secret
//   R2_BUCKET_NAME        — bucket name, e.g. "wtw-city-cache"
// If any are missing, isConfigured() is false and the app falls back to
// Overpass + localStorage (no breakage, just no shared cache).

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { gzipSync, gunzipSync } from "node:zlib";

export function isConfigured() {
  return !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

let client = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

// Download an object's text content (transparently gunzipping objects we
// stored compressed), or null when it doesn't exist.
export async function downloadObject(key) {
  try {
    const res = await getClient().send(
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key })
    );
    const bytes = await res.Body.transformToByteArray();
    if (res.ContentEncoding === "gzip" || (bytes[0] === 0x1f && bytes[1] === 0x8b)) {
      return gunzipSync(Buffer.from(bytes)).toString("utf8");
    }
    return Buffer.from(bytes).toString("utf8");
  } catch (e) {
    if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw e;
  }
}

// Upload text content under a key (overwrites). JSON compresses 6-10×,
// so everything is stored gzipped — 10 GB of free tier goes a lot further.
export async function uploadObject(key, text) {
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: gzipSync(Buffer.from(text, "utf8")),
      ContentType: "application/json",
      ContentEncoding: "gzip",
    })
  );
}
