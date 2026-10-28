import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "assets", "manifest.json");
const reportPath = path.join(root, "benchmarks", "results", "stage3", "glb-optimization.json");
const cliPath = path.join(root, "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
const EXPECTED_CLI_VERSION = "4.5.0";
const EXT_JSON = 0x4e4f534a;
const EXT_BIN = 0x004e4942;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`gltf-transform ${args.join(" ")} failed (${result.status})\n${output}`);
  }
  return output;
}

function parseGlb(filePath) {
  const bytes = readFileSync(filePath);
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") {
    throw new Error(`${filePath} is not a GLB file`);
  }
  const version = bytes.readUInt32LE(4);
  const totalLength = bytes.readUInt32LE(8);
  if (version !== 2 || totalLength !== bytes.length) {
    throw new Error(`${filePath} has invalid GLB header (version=${version}, declared=${totalLength}, actual=${bytes.length})`);
  }

  let json = null;
  let binary = Buffer.alloc(0);
  for (let offset = 12; offset < totalLength;) {
    if (offset + 8 > totalLength) throw new Error(`${filePath} has a truncated GLB chunk header`);
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > totalLength) throw new Error(`${filePath} has a truncated GLB chunk`);
    const chunk = bytes.subarray(offset, offset + length);
    offset += length;
    if (type === EXT_JSON) json = JSON.parse(chunk.toString("utf8").replace(/[\u0000\u0020]+$/u, ""));
    else if (type === EXT_BIN) binary = chunk;
  }
  if (!json) throw new Error(`${filePath} is missing its JSON chunk`);
  return { bytes, json, binary };
}

function getSummary(filePath) {
  const { bytes, json, binary } = parseGlb(filePath);
  const accessors = json.accessors ?? [];
  let vertices = 0;
  let triangles = 0;
  const attributes = new Set();
  const bounds = [];
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const positionIndex = primitive.attributes?.POSITION;
      if (positionIndex === undefined) throw new Error(`${filePath} contains a primitive without POSITION`);
      const position = accessors[positionIndex];
      if (!position) throw new Error(`${filePath} contains an invalid POSITION accessor`);
      vertices += position.count;
      const indexCount = primitive.indices === undefined
        ? position.count
        : accessors[primitive.indices]?.count;
      if (!Number.isInteger(indexCount)) throw new Error(`${filePath} contains an invalid index accessor`);
      const mode = primitive.mode ?? 4;
      if (mode === 4) triangles += indexCount / 3;
      else if (mode === 5 || mode === 6) triangles += Math.max(0, indexCount - 2);
      for (const attributeName of Object.keys(primitive.attributes ?? {})) attributes.add(attributeName);
      bounds.push({ min: position.min ?? null, max: position.max ?? null });
    }
  }

  const images = (json.images ?? []).map((image) => {
    if (image.uri) throw new Error(`${filePath} still references an external image URI: ${image.uri}`);
    if (image.bufferView === undefined) throw new Error(`${filePath} has an image that is not embedded in a bufferView`);
    const view = json.bufferViews?.[image.bufferView];
    if (!view) throw new Error(`${filePath} has an invalid image bufferView`);
    const start = view.byteOffset ?? 0;
    const imageBytes = binary.subarray(start, start + view.byteLength);
    return {
      mimeType: image.mimeType ?? null,
      bytes: imageBytes.length,
      sha256: sha256(imageBytes),
    };
  });

  const textureSlots = [];
  for (const material of json.materials ?? []) {
    const pbr = material.pbrMetallicRoughness ?? {};
    for (const slot of ["baseColorTexture", "metallicRoughnessTexture"]) {
      if (pbr[slot]) textureSlots.push(`pbrMetallicRoughness.${slot}`);
    }
    for (const slot of ["normalTexture", "occlusionTexture", "emissiveTexture"]) {
      if (material[slot]) textureSlots.push(slot);
    }
  }

  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    gzipBytes: zlib.gzipSync(bytes, { level: 9 }).length,
    brotliBytes: zlib.brotliCompressSync(bytes, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length,
    nodes: (json.nodes ?? []).length,
    meshes: (json.meshes ?? []).length,
    primitives: (json.meshes ?? []).reduce((sum, mesh) => sum + (mesh.primitives ?? []).length, 0),
    materials: (json.materials ?? []).length,
    textures: (json.textures ?? []).length,
    images,
    textureSlots,
    vertices,
    triangles,
    attributes: [...attributes].sort(),
    positionBounds: bounds,
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
  };
}

function assertPreserved(before, after, id, { allowTriangleChange = false } = {}) {
  for (const key of ["nodes", "meshes", "primitives", "materials", "textures", "textureSlots"]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      throw new Error(`${id}: ${key} changed during optimization`);
    }
  }
  if (!allowTriangleChange && before.triangles !== after.triangles) {
    throw new Error(`${id}: triangle count changed (${before.triangles} -> ${after.triangles})`);
  }
  if (JSON.stringify(before.attributes) !== JSON.stringify(after.attributes)) {
    throw new Error(`${id}: mesh attributes changed during optimization`);
  }
  if (JSON.stringify(before.positionBounds) !== JSON.stringify(after.positionBounds)) {
    throw new Error(`${id}: position bounds changed during optimization`);
  }
  if (JSON.stringify(before.images) !== JSON.stringify(after.images)) {
    throw new Error(`${id}: embedded image bytes changed during optimization`);
  }
  if ((after.extensionsUsed?.length ?? 0) || (after.extensionsRequired?.length ?? 0)) {
    throw new Error(`${id}: adopted output unexpectedly uses a glTF extension`);
  }
  if (after.vertices > before.vertices) throw new Error(`${id}: vertex count increased during optimization`);
}

function total(models, field) {
  return models.reduce((sum, model) => sum + model[field], 0);
}

function makeTempDirectory() {
  const parent = path.resolve(os.tmpdir());
  const tempPath = mkdtempSync(path.join(parent, "walk-world-glb-stage37-"));
  return { parent, tempPath };
}

function safeRemoveTemp(parent, tempPath) {
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(tempPath);
  if (!resolvedTarget.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error(`Refusing to remove temporary directory outside ${resolvedParent}: ${resolvedTarget}`);
  }
  rmSync(resolvedTarget, { recursive: true, force: true });
}

function main() {
  if (!existsSync(cliPath)) {
    throw new Error(`Missing glTF Transform CLI at ${cliPath}. Run npm install first.`);
  }
  const cliVersion = runCli(["--version"]).trim();
  if (cliVersion !== EXPECTED_CLI_VERSION) {
    throw new Error(`Expected glTF Transform CLI ${EXPECTED_CLI_VERSION}, got ${cliVersion}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const models = manifest.propKit?.models;
  if (!Array.isArray(models) || models.length === 0) throw new Error("Asset manifest has no propKit.models");

  const alreadyOptimized = models.every((model) => {
    const outputPath = path.join(root, "assets", model.outputFile);
    return model.optimization?.tool === `glTF Transform CLI ${cliVersion}`
      && model.outputRevision === "stage3-geometry-r2"
      && existsSync(outputPath)
      && model.processedSha256 === sha256(readFileSync(outputPath));
  });
  if (alreadyOptimized) {
    for (const model of models) {
      const outputPath = path.join(root, "assets", model.outputFile);
      const summary = getSummary(outputPath);
      if (summary.extensionsUsed.length || summary.extensionsRequired.length) {
        throw new Error(`${model.id}: already-optimized output unexpectedly has extensions`);
      }
      runCli(["validate", outputPath]);
    }
    console.log(`Validated ${models.length} already-optimized props; no asset changes needed.`);
    return;
  }

  const { parent: tempParent, tempPath } = makeTempDirectory();
  const stagedOutputs = [];
  const reportModels = [];
  try {
    for (const model of models) {
      const sourcePath = path.join(root, "assets", model.outputFile);
      if (!existsSync(sourcePath)) throw new Error(`Missing processed prop: ${sourcePath}`);
      const before = getSummary(sourcePath);
      const modelDir = path.join(tempPath, model.id.replace(/[^a-z0-9-]/giu, "-"));
      mkdirSync(modelDir, { recursive: true });
      const prunedPath = path.join(modelDir, "pruned.glb");
      const dedupedPath = path.join(modelDir, "deduped.glb");
      const optimizedPath = path.join(modelDir, "optimized.glb");

      // Conservative, decoder-free pipeline: remove unreferenced data, share
      // duplicate properties, then merge only bitwise-identical vertices.
      const pruneLog = runCli(["prune", sourcePath, prunedPath]);
      const dedupLog = runCli(["dedup", prunedPath, dedupedPath]);
      const weldLog = runCli(["weld", dedupedPath, optimizedPath]);
      const validationLog = runCli(["validate", optimizedPath]);
      if (!validationLog.includes("No errors found.")) {
        throw new Error(`${model.id}: glTF validation did not report success\n${validationLog}`);
      }

      const optimized = getSummary(optimizedPath);
      assertPreserved(before, optimized, model.id);
      const meshoptPath = path.join(modelDir, "meshopt.glb");
      const dracoPath = path.join(modelDir, "draco.glb");
      const simplifyStrictPath = path.join(modelDir, "simplify-strict.glb");
      const simplifyLoosePath = path.join(modelDir, "simplify-loose.glb");
      runCli(["meshopt", optimizedPath, meshoptPath, "--level", "high"]);
      runCli(["draco", optimizedPath, dracoPath, "--method", "edgebreaker"]);
      runCli(["simplify", optimizedPath, simplifyStrictPath, "--ratio", "0.75", "--error", "0.001"]);
      runCli(["simplify", optimizedPath, simplifyLoosePath, "--ratio", "0.75", "--error", "0.01"]);

      const codecResults = {};
      for (const [name, candidatePath] of [["meshopt", meshoptPath], ["draco", dracoPath]]) {
        const summary = getSummary(candidatePath);
        codecResults[name] = {
          bytes: summary.bytes,
          gzipBytes: summary.gzipBytes,
          brotliBytes: summary.brotliBytes,
          extensionsUsed: summary.extensionsUsed,
          extensionsRequired: summary.extensionsRequired,
        };
      }
      const simplifyResults = {};
      for (const [name, candidatePath] of [["strict", simplifyStrictPath], ["loose", simplifyLoosePath]]) {
        const summary = getSummary(candidatePath);
        simplifyResults[name] = {
          bytes: summary.bytes,
          vertices: summary.vertices,
          triangles: summary.triangles,
          positionBounds: summary.positionBounds,
          extensionsUsed: summary.extensionsUsed,
        };
      }

      const stagePath = path.join(path.dirname(sourcePath), `.${path.basename(sourcePath)}.stage37`);
      copyFileSync(optimizedPath, stagePath);
      stagedOutputs.push({ model, sourcePath, stagePath, before, optimized });
      reportModels.push({
        id: model.id,
        file: model.outputFile,
        normalized: before,
        optimized,
        meshopt: codecResults.meshopt,
        draco: codecResults.draco,
        simplify: simplifyResults,
        transformLogs: {
          prune: pruneLog.split("\n").filter(Boolean),
          dedup: dedupLog.split("\n").filter(Boolean),
          weld: weldLog.split("\n").filter(Boolean),
          validate: validationLog.split("\n").filter(Boolean),
        },
      });
    }

    const report = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      revision: "stage3-glb-optimization-r1",
      toolchain: {
        gltfTransformCli: cliVersion,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
      },
      pipeline: ["prune", "dedup", "weld"],
      simplificationTrials: [
        { ratio: 0.75, error: 0.001, adopted: false },
        { ratio: 0.75, error: 0.01, adopted: false },
      ],
      codecTrials: ["meshopt", "draco"],
      codecTotals: Object.fromEntries(["meshopt", "draco"].map((codec) => [codec,
        Object.fromEntries(["bytes", "gzipBytes", "brotliBytes"].map((field) => [
          field,
          total(reportModels.map((model) => model[codec]), field),
        ])),
      ])),
      models: reportModels,
      totals: Object.fromEntries(["bytes", "gzipBytes", "brotliBytes", "vertices", "triangles"].map((field) => [
        field,
        {
          normalized: total(reportModels.map((model) => model.normalized), field),
          optimized: total(reportModels.map((model) => model.optimized), field),
        },
      ])),
      decisions: {
        geometryCompression: "trial only; outputs require runtime decoder integration and improve compressed transfer size only slightly for these map-dominated assets",
        triangleSimplification: "trial only; the 0.01 error candidate squared the traffic-light lenses in four-view review",
      },
    };

    manifest.outputRevision = "stage3-pipeline-r4";
    manifest.status = "source snapshots, PBR atlases, content-addressed KTX2 runtime maps and self-contained optimized props built; browser offline/failure, mobile acceptance and prop runtime adoption remain pending";
    manifest.propKit.optimization = {
      revision: "stage3-glb-optimization-r1",
      tool: "glTF Transform CLI " + cliVersion,
      transforms: ["prune", "dedup", "weld"],
      codecTrials: { meshopt: "measured but not adopted", draco: "measured but not adopted" },
      simplification: "measured but not adopted; see benchmarks/results/stage3/glb-optimization.json",
    };

    for (const { model, optimized } of stagedOutputs) {
      const inputSummary = reportModels.find((entry) => entry.id === model.id).normalized;
      model.preOptimizationSha256 = inputSummary.sha256;
      model.preOptimizationBytes = inputSummary.bytes;
      model.processedSha256 = optimized.sha256;
      model.processedBytes = optimized.bytes;
      model.outputRevision = "stage3-geometry-r2";
      model.optimization = {
        tool: "glTF Transform CLI " + cliVersion,
        transforms: ["prune", "dedup", "weld"],
        verticesBefore: inputSummary.vertices,
        verticesAfter: optimized.vertices,
        trianglesBefore: inputSummary.triangles,
        trianglesAfter: optimized.triangles,
      };
      const normalizationModel = manifest.propKit.normalization?.models?.find((entry) => entry.id === model.id);
      if (normalizationModel) {
        normalizationModel.preOptimizationSha256 = model.preOptimizationSha256;
        normalizationModel.preOptimizationBytes = model.preOptimizationBytes;
        normalizationModel.sha256 = optimized.sha256;
        normalizationModel.bytes = optimized.bytes;
      }
    }

    const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    const nextReport = `${JSON.stringify(report, null, 2)}\n`;
    mkdirSync(path.dirname(reportPath), { recursive: true });
    const manifestStage = `${manifestPath}.stage37`;
    const reportStage = `${reportPath}.stage37`;
    writeFileSync(manifestStage, nextManifest, "utf8");
    writeFileSync(reportStage, nextReport, "utf8");

    for (const { sourcePath, stagePath } of stagedOutputs) {
      renameSync(stagePath, sourcePath);
    }
    renameSync(manifestStage, manifestPath);
    renameSync(reportStage, reportPath);

    const totals = report.totals;
    const pct = ((totals.bytes.normalized - totals.bytes.optimized) / totals.bytes.normalized) * 100;
    console.log(`Optimized ${stagedOutputs.length} props with ${cliVersion}: ${totals.bytes.normalized} -> ${totals.bytes.optimized} bytes (${pct.toFixed(1)}% smaller), ${reportPath}`);
  } finally {
    for (const { sourcePath } of stagedOutputs) {
      const staleStage = `${sourcePath}.stage37`;
      if (existsSync(staleStage)) rmSync(staleStage, { force: true });
    }
    safeRemoveTemp(tempParent, tempPath);
  }
}

main();
