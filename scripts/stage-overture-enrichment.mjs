// Build a local-only Overture enrichment stage from an already reviewed city
// refresh. This command never reads or writes R2; uploading remains a separate,
// explicitly approved operation through upload-city-refresh-stage.mjs.
//
//   npm run seed:stage-overture -- --input-stage=.cell-refresh-staging/hpi-demo-2026-10-31 \
//     --overture-index=benchmarks/results/stage0/sec1-overture-index-2026-10-31.json \
//     --output-stage=.cell-refresh-staging/b4-overture-demo-review

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deriveCellEnrichment, deriveOvertureBuildingPatches } from "../lib/engine/cell-enrichment.js";
import { isCompleteCity, MAX_CITY_BYTES, parseCityKey } from "../lib/city-contract.js";
import { countRefreshBuildings } from "./city-refresh-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/^"|"$/gu, "") : null;
};
const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function usage() {
  console.log(
    "Usage: npm run seed:stage-overture -- --input-stage=<ready-stage> " +
    "--overture-index=<reviewed-index.json> --output-stage=<new-local-stage>\n" +
    "This command only reads public Overture Parquet data and local stage files. It never writes to R2."
  );
}

function readJson(filePath, label) {
  const text = readFileSync(filePath, "utf8");
  let value;
  try { value = JSON.parse(text); }
  catch (error) { throw new Error(`${label}: invalid JSON (${error.message})`); }
  return { text, value };
}

function writeAtomic(filePath, contents) {
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, contents, "utf8");
  renameSync(tempPath, filePath);
}

function union(items = []) {
  return [...new Set(items.filter((item) => typeof item === "string" && item.trim()))];
}

function uniqueRecords(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const inputStageArg = option("input-stage");
const indexArg = option("overture-index");
const outputStageArg = option("output-stage");
if (!inputStageArg || !indexArg || !outputStageArg) {
  usage();
  process.exit(2);
}

const stagingRoot = path.resolve(ROOT, ".cell-refresh-staging");
const inputStage = path.resolve(inputStageArg);
const indexPath = path.resolve(indexArg);
const outputStage = path.resolve(outputStageArg);
const outputRelative = path.relative(stagingRoot, outputStage);
if (!outputRelative || outputRelative.startsWith("..") || path.isAbsolute(outputRelative)) {
  throw new Error(`Output stage must be a new child of ${stagingRoot}`);
}
const inputRelativeToOutput = path.relative(inputStage, outputStage);
if (inputStage === outputStage ||
    (inputRelativeToOutput && !inputRelativeToOutput.startsWith("..") && !path.isAbsolute(inputRelativeToOutput)) ||
    existsSync(outputStage)) {
  throw new Error(`Output stage already exists or aliases the input stage: ${outputStage}`);
}

const sourceManifestFile = readJson(path.join(inputStage, "manifest.json"), "Input manifest");
const sourceManifest = sourceManifestFile.value;
if (sourceManifest?.schemaVersion !== 1 || sourceManifest.status !== "ready" ||
    !Array.isArray(sourceManifest.cells) || sourceManifest.cells.length === 0 ||
    sourceManifest.totalCells !== sourceManifest.cells.length ||
    sourceManifest.readyCells !== sourceManifest.cells.length || sourceManifest.failedCells !== 0) {
  throw new Error("Input refresh stage must have a ready schema-1 manifest with consistent totals");
}

const indexFile = readJson(indexPath, "Overture index");
const overtureManifest = indexFile.value;
const releases = new Set(Array.isArray(overtureManifest)
  ? overtureManifest.map((entry) => /^s3:\/\/overturemaps-us-west-2\/release\/([^/]+)\//u.exec(entry?.[0] || "")?.[1]).filter(Boolean)
  : []);
if (!Array.isArray(overtureManifest) || overtureManifest.length === 0 || overtureManifest.some((entry) =>
  !Array.isArray(entry) || entry.length < 5 || typeof entry[0] !== "string" ||
  !entry[0].startsWith("s3://overturemaps-us-west-2/release/") ||
  !entry.slice(1, 5).every(Number.isFinite)) || releases.size !== 1) {
  throw new Error("Overture index must be a non-empty reviewed S3 manifest with finite bounds");
}
const overtureRelease = [...releases][0];

const seenKeys = new Set();
const inputCells = sourceManifest.cells.map((entry) => {
  if (!entry || entry.action !== "refresh" || entry.state !== "ready" ||
      typeof entry.key !== "string" || !parseCityKey(entry.key) || seenKeys.has(entry.key)) {
    throw new Error(`Input stage contains an invalid or duplicate refresh entry: ${entry?.key || "unknown"}`);
  }
  seenKeys.add(entry.key);
  const original = readJson(path.join(inputStage, "originals", `${entry.key}.json`), `${entry.key} original`);
  const candidate = readJson(path.join(inputStage, "candidates", `${entry.key}.json`), `${entry.key} candidate`);
  if (hash(original.text) !== entry.originalSha256 || hash(candidate.text) !== entry.candidateSha256 ||
      !isCompleteCity(original.value) || !isCompleteCity(candidate.value)) {
    throw new Error(`${entry.key}: source stage hashes or complete-cell validation do not match`);
  }
  const originalBuildings = countRefreshBuildings(original.value);
  const candidateBuildings = countRefreshBuildings(candidate.value);
  if (candidateBuildings < originalBuildings * 0.9) {
    throw new Error(`${entry.key}: source candidate retains fewer than 90% of original buildings`);
  }
  return { entry, originalText: original.text, original: original.value, candidate: candidate.value };
});

mkdirSync(outputStage, { recursive: false });
mkdirSync(path.join(outputStage, "originals"));
mkdirSync(path.join(outputStage, "candidates"));

const manifest = {
  schemaVersion: 1,
  buildingCountRuleVersion: 2,
  group: `${sourceManifest.group || "Demo"} with Overture enrichment`,
  placeFilter: sourceManifest.placeFilter ?? null,
  cellFilter: sourceManifest.cellFilter ?? null,
  sourceManifestSha256: hash(sourceManifestFile.text),
  overtureRelease,
  overtureManifestSha256: hash(indexFile.text),
  overtureManifestFiles: overtureManifest.length,
  createdAt: new Date().toISOString(),
  status: "in_progress",
  totalCells: inputCells.length,
  readyCells: 0,
  failedCells: 0,
  cells: inputCells.map(({ entry }) => ({ ...entry, state: "pending" })),
};
const manifestPath = path.join(outputStage, "manifest.json");
const saveManifest = () => writeAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
saveManifest();

const { queryBuildingsWithManifest } = await import("../lib/overtureServer.js");
const summaries = [];
for (let index = 0; index < inputCells.length; index++) {
  const source = inputCells[index];
  const entry = manifest.cells[index];
  const coords = parseCityKey(entry.key);
  try {
    const padding = 0.007;
    const result = await queryBuildingsWithManifest(
      overtureManifest,
      coords.lat - padding, coords.lat + padding,
      coords.lon - padding, coords.lon + padding,
    );
    if (result.status !== "ok") throw new Error(`Overture query status: ${result.status}`);

    const sourceEnrichment = source.original.enrichment || {};
    const candidateEnrichment = source.candidate.enrichment || {};
    const existingPatches = {
      ...(sourceEnrichment.patches || {}),
      ...(candidateEnrichment.patches || {}),
    };
    const patches = deriveOvertureBuildingPatches(source.candidate, result.buildings, existingPatches);
    const sources = union([
      ...(sourceEnrichment.sources || []),
      ...(candidateEnrichment.sources || []),
      ...(patches.fields > 0 ? ["overture"] : []),
    ]);
    const enrichment = deriveCellEnrichment(source.candidate, {
      sources,
      density: { ...(sourceEnrichment.density || {}), ...(candidateEnrichment.density || {}) },
      patches: { ...existingPatches, ...patches.patches },
      landmarks: uniqueRecords([...(sourceEnrichment.landmarks || []), ...(candidateEnrichment.landmarks || [])]),
      features: uniqueRecords([...(sourceEnrichment.features || []), ...(candidateEnrichment.features || [])]),
    });
    const candidate = { ...source.candidate, enrichment };
    const candidateText = JSON.stringify(candidate);
    if (Buffer.byteLength(candidateText, "utf8") > MAX_CITY_BYTES || !isCompleteCity(candidate)) {
      throw new Error("Enriched candidate exceeds the cell limit or is incomplete");
    }

    writeAtomic(path.join(outputStage, "originals", `${entry.key}.json`), source.originalText);
    writeAtomic(path.join(outputStage, "candidates", `${entry.key}.json`), candidateText);
    entry.state = "ready";
    entry.candidateSha256 = hash(candidateText);
    entry.candidateElements = candidate.elements.length;
    entry.candidateBuildings = countRefreshBuildings(candidate);
    entry.overtureRows = result.buildings.length;
    entry.overtureMatched = patches.matched;
    entry.overtureFields = patches.fields;
    entry.enrichmentCarried = !!source.original.enrichment;
    summaries.push({ key: entry.key, rows: result.buildings.length, matched: patches.matched, fields: patches.fields });
    console.log(`✓ ${index + 1}/${inputCells.length} ${entry.key}: ${patches.fields} Overture tags across ${patches.matched} matched buildings`);
  } catch (error) {
    entry.state = "failed";
    entry.error = error?.message || String(error);
    console.error(`✗ ${index + 1}/${inputCells.length} ${entry.key}: ${entry.error}`);
  }
  manifest.readyCells = manifest.cells.filter((cell) => cell.state === "ready").length;
  manifest.failedCells = manifest.cells.filter((cell) => cell.state === "failed").length;
  saveManifest();
}

manifest.status = manifest.failedCells === 0 ? "ready" : "incomplete";
manifest.completedAt = new Date().toISOString();
saveManifest();
writeAtomic(path.join(outputStage, "overture-summary.json"), `${JSON.stringify({
  release: manifest.overtureRelease,
  manifestSha256: manifest.overtureManifestSha256,
  cells: summaries,
}, null, 2)}\n`);

if (manifest.status !== "ready") {
  throw new Error(`Local Overture stage is incomplete: ${manifest.readyCells}/${manifest.totalCells} cells ready; inspect ${manifestPath}`);
}

const verifierPath = fileURLToPath(new URL("./verify-city-refresh-stage.mjs", import.meta.url));
const verification = spawnSync(process.execPath, [verifierPath, `--stage-dir=${outputStage}`], {
  cwd: ROOT,
  stdio: "inherit",
});
if (verification.error || verification.status !== 0) {
  manifest.status = "incomplete";
  manifest.validationError = verification.error?.message || `Verifier exited with status ${verification.status}`;
  saveManifest();
  throw new Error(`Local Overture stage failed verification: ${manifest.validationError}`);
}

console.log(`Local-only Overture stage verified: ${manifest.readyCells}/${manifest.totalCells} cells. No R2 access or writes were made.`);
