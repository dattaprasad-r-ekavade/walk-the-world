// Verify a locally staged city-cache refresh before any separate upload step.
// This reads only the stage directory and never connects to R2 or Overpass.
//
//   node scripts/verify-city-refresh-stage.mjs --stage-dir=.cell-refresh-staging/demo-<timestamp>

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isCompleteCity, MAX_CITY_BYTES, parseCityKey } from "../lib/city-contract.js";
import { countRefreshBuildings } from "./city-refresh-rules.mjs";

const stageArg = process.argv.slice(2).find((arg) => arg.startsWith("--stage-dir="));
if (!stageArg) {
  console.error("Pass --stage-dir=<completed staging directory>");
  process.exit(1);
}

const stageDir = path.resolve(stageArg.slice("--stage-dir=".length).replace(/"/g, ""));
const manifestPath = path.join(stageDir, "manifest.json");
const failures = [];
const hash = (text) => createHash("sha256").update(text).digest("hex");

function readJson(filePath, description) {
  try {
    const text = readFileSync(filePath, "utf8");
    return { text, data: JSON.parse(text) };
  } catch (error) {
    failures.push(`${description}: ${error?.message || error}`);
    return null;
  }
}

const manifestFile = readJson(manifestPath, "manifest.json");
if (!manifestFile) process.exit(1);
const manifest = manifestFile.data;
if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
  console.error("manifest.json must contain an object");
  process.exit(1);
}
if (manifest.schemaVersion !== 1) failures.push(`Unsupported manifest schema: ${manifest.schemaVersion}`);
if (manifest.status !== "ready") failures.push(`Batch status is ${manifest.status}; expected ready`);
if (!Array.isArray(manifest.cells)) failures.push("Manifest cells must be an array");

const cells = Array.isArray(manifest.cells) ? manifest.cells : [];
const keys = new Set();
let verifiedCells = 0;
const stageLabel = cells.some((cell) => cell?.action === "create") ? "new-cell" : "refresh";
console.log(`Cell ${stageLabel} stage: ${manifest.group ?? "unknown group"} · ${cells.length} cells`);

for (const cell of cells) {
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
    failures.push("Manifest cell entry must be an object");
    continue;
  }
  const { key, place } = cell;
  if (typeof key !== "string" || !parseCityKey(key)) {
    failures.push(`Invalid city key: ${String(key)}`);
    continue;
  }
  const failureCountBeforeCell = failures.length;
  if (typeof place !== "string" || !place.trim()) failures.push(`${key}: place name is missing or invalid`);
  if (keys.has(key)) failures.push(`${key}: duplicate key in manifest`);
  keys.add(key);
  if (cell.state !== "ready") {
    failures.push(`${key}: state is ${cell.state}; expected ready`);
    continue;
  }
  const action = cell.action ?? "refresh";
  if (action !== "refresh" && action !== "create") {
    failures.push(`${key}: unsupported action ${String(action)}`);
    continue;
  }

  const candidateFile = readJson(path.join(stageDir, "candidates", `${key}.json`), `${key} candidate`);
  if (!candidateFile) continue;
  const candidate = candidateFile.data;
  if (!isCompleteCity(candidate)) failures.push(`${key}: candidate is not a complete city cell`);
  if (Buffer.byteLength(candidateFile.text, "utf8") > MAX_CITY_BYTES) failures.push(`${key}: candidate exceeds ${MAX_CITY_BYTES} bytes`);
  const candidateHash = hash(candidateFile.text);
  if (candidateHash !== cell.candidateSha256) failures.push(`${key}: candidate hash does not match manifest`);
  const candidateElements = candidate?.elements?.length;
  const candidateBuildings = countRefreshBuildings(candidate);
  if (candidateElements !== cell.candidateElements) failures.push(`${key}: candidate element count does not match manifest`);
  if (candidateBuildings !== cell.candidateBuildings) failures.push(`${key}: candidate building count does not match manifest`);

  if (action === "create") {
    if (["originalSha256", "originalElements", "originalBuildings"].some((field) => Object.hasOwn(cell, field))) {
      failures.push(`${key}: new-cell entry must not claim original-cell metadata`);
    }
    if (failures.length === failureCountBeforeCell) {
      verifiedCells++;
      console.log(`✓ ${place.padEnd(12)} ${key}  new cell ${candidateBuildings} renderable ways, ${candidateElements} elements`);
    }
    continue;
  }

  const originalFile = readJson(path.join(stageDir, "originals", `${key}.json`), `${key} original`);
  if (!originalFile) continue;
  const original = originalFile.data;
  if (!isCompleteCity(original)) failures.push(`${key}: original is not a complete city cell`);
  const originalHash = hash(originalFile.text);
  if (originalHash !== cell.originalSha256) failures.push(`${key}: original hash does not match manifest`);
  const originalElements = original?.elements?.length;
  const originalBuildings = countRefreshBuildings(original);
  if (originalElements !== cell.originalElements) failures.push(`${key}: original element count does not match manifest`);
  if (originalBuildings !== cell.originalBuildings) failures.push(`${key}: original building count does not match manifest`);
  if (candidateBuildings < originalBuildings * 0.9) failures.push(`${key}: candidate retains fewer than 90% of buildings`);
  if (original?.enrichment && !candidate?.enrichment) failures.push(`${key}: candidate lost the original enrichment block`);

  if (failures.length === failureCountBeforeCell) {
    verifiedCells++;
    console.log(`✓ ${place.padEnd(12)} ${key}  buildings ${originalBuildings} -> ${candidateBuildings}, elements ${originalElements} -> ${candidateElements}`);
  }
}

if (manifest.totalCells !== cells.length) failures.push(`Manifest totalCells is ${manifest.totalCells}; found ${cells.length} entries`);
if (manifest.readyCells !== cells.length) failures.push(`Manifest readyCells is ${manifest.readyCells}; found ${cells.length} entries`);
if (manifest.failedCells !== 0) failures.push(`Manifest reports ${manifest.failedCells} failed cells`);
if (verifiedCells !== cells.length) failures.push(`Only ${verifiedCells}/${cells.length} cells passed local verification`);

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} issue(s)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASSED: all ${verifiedCells} staged cells match the manifest and refresh rules`);
}
