// Promote R2 city cache keys city5 → city6 (same JSON payload; version bump
// was Overpass query strategy only, not a schema change).
//
//   node --env-file=.env.local scripts/promote-city-cache.mjs
//   node --env-file=.env.local scripts/promote-city-cache.mjs --force   # overwrite existing city6
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { writeFileSync, readFileSync } from "fs";

const FORCE = process.argv.includes("--force");
const FROM = 5;
const TO = 6;
const STATE = "warm-state.json";

const endpoint = process.env.R2_ENDPOINT;
const bucket = process.env.R2_BUCKET_NAME;
if (!endpoint || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !bucket) {
  console.error("Missing R2_* env (use: node --env-file=.env.local scripts/promote-city-cache.mjs)");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function listPrefix(prefix) {
  const out = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      })
    );
    for (const o of res.Contents || []) out.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function exists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

const re = new RegExp(`^wtw_city${FROM}_(-?\\d+\\.\\d{3}_-?\\d+\\.\\d{3})\\.json$`);
const sources = (await listPrefix(`wtw_city${FROM}_`)).filter((k) => re.test(k));
console.log(`Found ${sources.length} city${FROM} objects in ${bucket}`);

let copied = 0;
let skipped = 0;
let failed = 0;
const done = new Set();
try {
  for (const k of JSON.parse(readFileSync(STATE, "utf8"))) done.add(k);
} catch {
  /* fresh */
}

const CONC = 8;
let i = 0;
async function worker() {
  while (i < sources.length) {
    const src = sources[i++];
    const m = src.match(re);
    const dest = `wtw_city${TO}_${m[1]}.json`;
    const cacheKey = dest.replace(/\.json$/, "");
    try {
      if (!FORCE && (await exists(dest))) {
        skipped++;
        done.add(cacheKey);
        continue;
      }
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `/${bucket}/${src}`,
          Key: dest,
          MetadataDirective: "COPY",
        })
      );
      copied++;
      done.add(cacheKey);
      if ((copied + skipped) % 25 === 0) {
        console.log(`… ${copied} copied, ${skipped} skipped, ${failed} failed`);
      }
    } catch (e) {
      failed++;
      console.warn(`✗ ${src} → ${dest}: ${e?.message || e}`);
    }
  }
}

await Promise.all(Array.from({ length: CONC }, () => worker()));
writeFileSync(STATE, JSON.stringify([...done].sort()));
console.log(
  `\nDone: ${copied} copied, ${skipped} already had city${TO}, ${failed} failed`
);
console.log(`warm-state.json now has ${done.size} keys`);
