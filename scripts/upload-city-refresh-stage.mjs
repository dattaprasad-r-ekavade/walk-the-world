// Upload a fully verified city-cache refresh stage after explicit approval.
// Dry-run is the default. Writes require --apply plus the exact manifest hash.
// The script preflights every live original before the first write and attempts
// to restore all touched keys if an upload or read-back verification fails.
//
//   node --env-file=.env.local scripts/upload-city-refresh-stage.mjs \
//     --stage-dir=.cell-refresh-staging/demo-run
//   node --env-file=.env.local scripts/upload-city-refresh-stage.mjs \
//     --stage-dir=.cell-refresh-staging/demo-run --apply --manifest-sha256=<sha256>

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCityKey } from "../lib/city-contract.js";
import { downloadObject, isConfigured, uploadObject } from "../lib/r2Server.js";

const args = process.argv.slice(2);
const option = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).replace(/"/g, "") : null;
};
const APPLY = args.includes("--apply");
const STAGE_DIR_ARG = option("stage-dir");
const APPROVED_MANIFEST_SHA256 = option("manifest-sha256")?.toLowerCase() || "";
const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function usage() {
  console.log(
    "Usage: node --env-file=.env.local scripts/upload-city-refresh-stage.mjs " +
    "--stage-dir=<dir> [--apply --manifest-sha256=<sha256>]\n" +
    "Without --apply, verifies and prints a local dry-run summary without contacting R2.\n" +
    "Writes require the exact ready-manifest hash, configured R2 credentials, and unchanged live originals."
  );
}

function loadStage() {
  if (!STAGE_DIR_ARG) throw new Error("Pass --stage-dir=<completed staging directory>");
  const stageDir = path.resolve(STAGE_DIR_ARG);
  const manifestPath = path.join(stageDir, "manifest.json");
  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  const manifestSha256 = hash(manifestText);

  if (manifest?.schemaVersion !== 1 || manifest?.status !== "ready") {
    throw new Error(`Stage manifest must be schema 1 and ready; found ${manifest?.status ?? "unknown"}`);
  }
  if (!Array.isArray(manifest.cells) || manifest.cells.length === 0) {
    throw new Error("Stage manifest has no cells");
  }
  if (manifest.totalCells !== manifest.cells.length
    || manifest.readyCells !== manifest.cells.length
    || manifest.failedCells !== 0) {
    throw new Error("Stage manifest totals do not match its ready cells");
  }

  const seen = new Set();
  const cells = manifest.cells.map((entry) => {
    if (!entry || entry.state !== "ready" || entry.action !== "refresh"
      || typeof entry.key !== "string" || !parseCityKey(entry.key)) {
      throw new Error("Only complete ready refresh manifests can be uploaded");
    }
    if (seen.has(entry.key)) throw new Error(`Duplicate key in manifest: ${entry.key}`);
    seen.add(entry.key);
    const originalText = readFileSync(path.join(stageDir, "originals", `${entry.key}.json`), "utf8");
    const candidateText = readFileSync(path.join(stageDir, "candidates", `${entry.key}.json`), "utf8");
    if (hash(originalText) !== entry.originalSha256) throw new Error(`${entry.key}: original hash mismatch`);
    if (hash(candidateText) !== entry.candidateSha256) throw new Error(`${entry.key}: candidate hash mismatch`);
    return { ...entry, originalText, candidateText };
  });

  const verifierPath = fileURLToPath(new URL("./verify-city-refresh-stage.mjs", import.meta.url));
  const verification = spawnSync(process.execPath, [verifierPath, `--stage-dir=${stageDir}`], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (verification.error) throw verification.error;
  if (verification.status !== 0) throw new Error("Local stage verifier did not pass");

  return { stageDir, manifest, manifestSha256, cells };
}

async function preflightLiveOriginals(cells) {
  const errors = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(4, cells.length) }, async () => {
    while (next < cells.length) {
      const cell = cells[next++];
      try {
        const liveText = await downloadObject(`${cell.key}.json`);
        if (liveText === null) errors.push(`${cell.key}: live R2 object is missing`);
        else if (hash(liveText) !== cell.originalSha256) errors.push(`${cell.key}: live R2 object changed since staging`);
      } catch (error) {
        errors.push(`${cell.key}: live R2 read failed (${error?.message || error})`);
      }
    }
  });
  await Promise.all(workers);
  if (errors.length) throw new Error(`R2 preflight failed; no objects were uploaded:\n- ${errors.join("\n- ")}`);
}

function saveJournal(journalPath, journal) {
  const tempPath = `${journalPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  renameSync(tempPath, journalPath);
}

async function uploadStage(stage) {
  if (!APPROVED_MANIFEST_SHA256 || APPROVED_MANIFEST_SHA256 !== stage.manifestSha256) {
    throw new Error(`--apply requires --manifest-sha256=${stage.manifestSha256}`);
  }
  if (!isConfigured()) throw new Error("Missing R2_* configuration in .env.local; no R2 request was made");

  const journalPath = path.join(stage.stageDir, `upload-journal-${stage.manifestSha256.slice(0, 12)}.json`);
  if (existsSync(journalPath)) throw new Error(`Upload journal already exists; inspect it before retrying: ${journalPath}`);

  console.log(`Preflighting ${stage.cells.length} live R2 originals against the approved manifest…`);
  await preflightLiveOriginals(stage.cells);
  console.log("All live originals match the staged hashes; beginning sequential upload.");

  const journal = {
    schemaVersion: 1,
    status: "in_progress",
    manifestSha256: stage.manifestSha256,
    group: stage.manifest.group,
    totalCells: stage.cells.length,
    startedAt: new Date().toISOString(),
    attemptedKeys: [],
    confirmedKeys: [],
    restoredKeys: [],
    rollbackFailures: [],
  };
  saveJournal(journalPath, journal);
  const operationAbort = new AbortController();
  const onInterrupt = (signal) => {
    journal.interruptionSignal = signal;
    operationAbort.abort(new Error(`Interrupted by ${signal}`));
  };
  const onSigint = () => onInterrupt("SIGINT");
  const onSigterm = () => onInterrupt("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    for (let index = 0; index < stage.cells.length; index++) {
      const cell = stage.cells[index];
      journal.attemptedKeys.push(cell.key);
      journal.currentKey = cell.key;
      saveJournal(journalPath, journal);

      await uploadObject(`${cell.key}.json`, cell.candidateText, { complete: true, signal: operationAbort.signal });
      const uploadedText = await downloadObject(`${cell.key}.json`, { signal: operationAbort.signal });
      if (uploadedText === null || hash(uploadedText) !== cell.candidateSha256) {
        throw new Error(`${cell.key}: uploaded object did not match its candidate hash`);
      }

      journal.confirmedKeys.push(cell.key);
      delete journal.currentKey;
      saveJournal(journalPath, journal);
      console.log(`✓ ${index + 1}/${stage.cells.length} ${cell.key}`);
    }
    journal.status = "complete";
    journal.finishedAt = new Date().toISOString();
    saveJournal(journalPath, journal);
    console.log(`Upload complete: ${journal.confirmedKeys.length}/${stage.cells.length} cells. Journal: ${journalPath}`);
  } catch (error) {
    journal.failure = error?.message || String(error);
    journal.status = "rolling_back";
    saveJournal(journalPath, journal);
    for (const key of [...journal.attemptedKeys].reverse()) {
      const cell = stage.cells.find((entry) => entry.key === key);
      try {
        await uploadObject(`${cell.key}.json`, cell.originalText, { complete: true });
        const restoredText = await downloadObject(`${cell.key}.json`);
        if (restoredText === null || hash(restoredText) !== cell.originalSha256) {
          throw new Error("restored object did not match its original hash");
        }
        journal.restoredKeys.push(cell.key);
      } catch (rollbackError) {
        journal.rollbackFailures.push(`${cell.key}: ${rollbackError?.message || rollbackError}`);
      }
      saveJournal(journalPath, journal);
    }
    journal.status = journal.rollbackFailures.length ? "rollback_incomplete" : "rolled_back";
    journal.finishedAt = new Date().toISOString();
    saveJournal(journalPath, journal);
    throw new Error(
      `Upload failed (${journal.failure}); rollback status: ${journal.status}. ` +
      `Inspect ${journalPath}${journal.rollbackFailures.length ? `; rollback failures: ${journal.rollbackFailures.join("; ")}` : ""}`
    );
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

async function main() {
  if (args.includes("--help") || args.includes("-h")) return usage();
  const supported = new Set(["--apply", "--stage-dir", "--manifest-sha256"]);
  for (const arg of args) {
    if (arg === "--apply") continue;
    if (!arg.startsWith("--") || !supported.has(arg.slice(0, arg.indexOf("=")))) {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }

  const stage = loadStage();
  console.log(`Stage ${stage.manifest.group ?? "unknown"}: ${stage.cells.length} verified cells`);
  console.log(`Manifest SHA-256: ${stage.manifestSha256}`);
  if (!APPLY) {
    console.log("Dry run only: no R2 request or write was made. Pass --apply and the exact manifest hash after approval.");
    return;
  }
  await uploadStage(stage);
}

main().catch((error) => {
  console.error(`[upload-city-refresh-stage] ${error?.message || error}`);
  process.exitCode = 1;
});
