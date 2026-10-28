#!/usr/bin/env node
/**
 * Stamps public/sw.js CACHE_REVISION so every deployed build gets a fresh shell
 * cache. Runs as `prebuild`. Revision = sha256(package version + commit sha +
 * runtime texture revision). Commit sha: VERCEL_GIT_COMMIT_SHA, else
 * `git rev-parse --short HEAD`, else a timestamp. Deterministic per commit, so
 * rebuilding the same commit rewrites the same value (the file is only dirty in
 * git when HEAD differs from the commit that last stamped it).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const swPath = path.join(root, "public", "sw.js");

function commitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const manifestPath = path.join(root, "public", "textures", "ktx2", "runtime-manifest.json");
const textureRevision = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8")).revision ?? ""
  : "";
const sha = commitSha() ?? `t${Date.now()}`;
const revision = createHash("sha256")
  .update([pkg.version, sha, textureRevision].join("\n"))
  .digest("hex")
  .slice(0, 16);

const pattern = /(const CACHE_REVISION = )["'][^"']*["'];/u;
const source = readFileSync(swPath, "utf8");
if (!pattern.test(source)) throw new Error("public/sw.js is missing the CACHE_REVISION declaration");
const next = source.replace(pattern, `$1${JSON.stringify(revision)};`);
if (next !== source) writeFileSync(swPath, next, "utf8");
console.log(`sw.js CACHE_REVISION = ${revision} (${sha})`);
