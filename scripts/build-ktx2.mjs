import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "assets", "manifest.json");
const outputRoot = path.join(root, "assets", "processed", "ktx2");
const EXPECTED_VERSION = "v4.4.2";
const RELEASE_URL = "https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2";
const WINDOWS_X64_INSTALLER_SHA256 = "1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe";

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function runKtx(ktx, args, { allowOutput = true } = {}) {
  const result = spawnSync(ktx, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`KTX command failed (${result.status}): ${args.join(" ")}\n${output}`);
  }
  if (allowOutput && output) process.stdout.write(`${output}\n`);
  return output;
}

function resolveKtx() {
  const configured = process.env.KTX_BIN;
  if (!configured) return process.platform === "win32" ? "ktx.exe" : "ktx";
  const resolved = path.resolve(configured);
  try {
    return statSync(resolved).isDirectory()
      ? path.join(resolved, process.platform === "win32" ? "ktx.exe" : "ktx")
      : resolved;
  } catch {
    return resolved;
  }
}

function formatFor(channels, colorSpace) {
  const component = channels === 4 ? "R8G8B8A8" : "R8G8B8";
  return `${component}_${colorSpace === "sRGB" ? "SRGB" : "UNORM"}`;
}

function createVariants(ktx, input, colorSpace, channels, previousImageRecord) {
  const format = formatFor(channels, colorSpace);
  const transfer = colorSpace === "sRGB" ? "srgb" : "linear";
  const primaries = colorSpace === "sRGB" ? "srgb" : "none";
  const common = [
    "--format", format,
    "--assign-tf", transfer,
    "--assign-primaries", primaries,
    "--assign-texcoord-origin", "top-left",
    "--threads", "1",
  ];
  const variants = {
    etc1s: {
      relativePath: path.posix.join("processed/ktx2/etc1s", `${input.id}.ktx2`),
      settings: {
        encode: "basis-lz",
        clevel: 1,
        qlevel: 128,
        mipLevels: 1,
      },
      args: ["--encode", "basis-lz", "--clevel", "1", "--qlevel", "128", "--compare-psnr"],
    },
    uastc: {
      relativePath: path.posix.join("processed/ktx2/uastc", `${input.id}.ktx2`),
      settings: {
        encode: "uastc",
        quality: 2,
        rdoLambda: input.id.includes("normal") ? 0.5 : 1.0,
        rdoMultithreading: false,
        zstd: 18,
        mipLevels: 1,
      },
      args: [
        "--encode", "uastc",
        "--uastc-quality", "2",
        "--uastc-rdo",
        "--uastc-rdo-l", input.id.includes("normal") ? "0.5" : "1.0",
        "--uastc-rdo-m",
        "--zstd", "18",
        "--compare-psnr",
      ],
    },
  };

  const outputRecords = {};
  for (const [name, variant] of Object.entries(variants)) {
    const outputPath = path.join(root, "assets", variant.relativePath);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const previousRecord = previousImageRecord?.variants?.[name];
    if (
      previousImageRecord?.inputSha256 === input.sha256 &&
      previousImageRecord?.format === format &&
      previousRecord?.file === variant.relativePath &&
      JSON.stringify(previousRecord.settings) === JSON.stringify(variant.settings) &&
      statSync(outputPath, { throwIfNoEntry: false })?.isFile() &&
      sha256(outputPath) === previousRecord.sha256
    ) {
      runKtx(ktx, ["validate", "--gltf-basisu", outputPath], { allowOutput: false });
      process.stdout.write(`\n[ktx2] ${input.id} → ${name} (reuse verified output)\n`);
      outputRecords[name] = previousRecord;
      continue;
    }
    rmSync(outputPath, { force: true });
    process.stdout.write(`\n[ktx2] ${input.id} → ${name} (${format})\n`);
    const qualityOutput = runKtx(ktx, [
      "create",
      ...common,
      ...variant.args,
      input.absolutePath,
      outputPath,
    ]);
    runKtx(ktx, ["validate", "--gltf-basisu", outputPath], { allowOutput: false });
    if (!statSync(outputPath).size) throw new Error(`KTX produced an empty file: ${outputPath}`);
    const psnr = qualityOutput.match(/PSNR Max:\s*([\d.]+)/i)?.[1];
    outputRecords[name] = {
      file: variant.relativePath,
      bytes: statSync(outputPath).size,
      sha256: sha256(outputPath),
      psnrMaxDb: psnr ? Number(psnr) : null,
      settings: variant.settings,
    };
  }
  return { format, outputRecords };
}

function writeComparison(pilot) {
  const sizeCell = (output, inputBytes, decodedMetrics) =>
    `${(output.bytes / 1024).toFixed(1)} KB (${(100 * output.bytes / inputBytes).toFixed(1)}%); ${decodedMetrics.meanRgbDb.toFixed(2)} dB`;
  const lines = [
    "# KTX2 atlas compression pilot",
    "",
    `Toolchain: KTX-Software ${pilot.toolchain.version}; source revision ${pilot.sourceRevision}.`,
    "All inputs are base-level atlases. Mip generation is deferred to Stage 3.6 so the current 16 px gutters can be reviewed independently.",
    "Sizes below are transfer-file sizes. GPU residency depends on the runtime transcode target and is not inferred from these KTX2 byte counts.",
    "",
    "| Map | Space | PNG | ETC1S (size; RGB PSNR) | UASTC (size; RGB PSNR) | Mask IoU ETC1S / UASTC |",
    "|---|---|---:|---:|---:|---:|",
  ];
  for (const image of pilot.images) {
    const etc = image.variants.etc1s;
    const uas = image.variants.uastc;
    const etcMetrics = image.qualityMetrics.decodedRgba8.etc1s;
    const uasMetrics = image.qualityMetrics.decodedRgba8.uastc;
    const maskScore = (metrics) => metrics.alphaMaskIoUAt128 ?? metrics.brightWindowMaskIoUAtRgbMax200;
    const etcMask = maskScore(etcMetrics);
    const uasMask = maskScore(uasMetrics);
    const maskCell = etcMask == null ? "—" : `${etcMask.toFixed(4)} / ${uasMask.toFixed(4)}`;
    lines.push(
      `| ${image.id} | ${image.colorSpace} | ${image.inputBytes} | ${sizeCell(etc, image.inputBytes, etcMetrics)} | ${sizeCell(uas, image.inputBytes, uasMetrics)} | ${maskCell} |`,
    );
  }
  lines.push(
    "",
    "RGB PSNR compares stored 8-bit channel values in the original PNG and the RGBA8 KTX decode; it is not perceptually weighted. Mask IoU uses facade albedo alpha at threshold 128 and emissive RGB maximum at threshold 200. The manifest retains per-channel metrics and KTX encoder PSNR Max values.",
    "See `quality-review.png` and `quality-review-facade-detail.png` for the decoded comparisons.",
    "",
  );
  writeFileSync(path.join(outputRoot, "comparison.md"), lines.join("\n"), "utf8");
}

function main() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const ktx = resolveKtx();
  const versionOutput = runKtx(ktx, ["--version"], { allowOutput: false });
  if (!versionOutput.includes(EXPECTED_VERSION)) {
    throw new Error(`Expected KTX-Software ${EXPECTED_VERSION}; got: ${versionOutput || "no version output"}`);
  }

  const mapDefinitions = [
    { id: "material-basecolor", map: manifest.materialAtlases.maps.color, channels: 3 },
    { id: "material-normal", map: manifest.materialAtlases.maps.normalGL, channels: 3 },
    { id: "material-roughness", map: manifest.materialAtlases.maps.roughness, channels: 3 },
    { id: "material-ao", map: manifest.materialAtlases.maps.ambientOcclusion, channels: 3 },
    { id: "facade-basecolor", map: manifest.facadeAtlases.packed.maps.basecolor, channels: 4 },
    { id: "facade-normal", map: manifest.facadeAtlases.packed.maps.normal, channels: 4 },
    { id: "facade-roughness", map: manifest.facadeAtlases.packed.maps.roughness, channels: 4 },
    { id: "facade-ao", map: manifest.facadeAtlases.packed.maps.ao, channels: 4 },
    { id: "facade-emissive", map: manifest.facadeAtlases.packed.maps.emissive, channels: 4 },
  ];
  mkdirSync(outputRoot, { recursive: true });

  const previousPilot = manifest.ktx2Pilot;
  const canReusePriorRun = previousPilot?.revision === "stage3.4-ktx2-pilot-r1" &&
    previousPilot?.toolchain?.version === EXPECTED_VERSION;
  const previousImages = new Map(
    canReusePriorRun ? (previousPilot.images ?? []).map((image) => [image.id, image]) : [],
  );
  const pilot = {
    revision: "stage3.4-ktx2-pilot-r1",
    sourceRevision: manifest.outputRevision,
    status: "building",
    toolchain: {
      name: "KTX-Software",
      version: EXPECTED_VERSION,
      releaseUrl: RELEASE_URL,
      windowsX64InstallerSha256: WINDOWS_X64_INSTALLER_SHA256,
      encoder: "ktx create",
      comparisonTranscoder: "ktx extract",
    },
    encoding: {
      etc1s: { codec: "basis-lz", compressionLevel: 1, qualityLevel: 128, threads: 1 },
      uastc: {
        codec: "uastc",
        qualityLevel: 2,
        rdo: true,
        rdoLambda: "1.0; 0.5 for normal maps",
        rdoMultithreading: false,
        zstdLevel: 18,
        threads: 1,
      },
      mipLevels: 1,
      textureOrigin: "top-left",
      normalRgbPreserved: true,
      runtimeAdoption: "deferred to Stage 3.5",
    },
    images: [],
    review: {
      allAtlases: "processed/ktx2/quality-review.png",
      facadeWindowAndMaskDetail: "processed/ktx2/quality-review-facade-detail.png",
    },
  };

  const images = [];
  const reviewRoot = mkdtempSync(path.join(os.tmpdir(), "walk-the-world-ktx2-review-"));
  try {
    const reviewEntries = [];
    for (const definition of mapDefinitions) {
      const absolutePath = path.join(root, "assets", definition.map.file);
      const inputHash = sha256(absolutePath);
      if (definition.map.sha256 && inputHash !== definition.map.sha256) {
        throw new Error(`Input atlas hash mismatch for ${definition.id}: ${inputHash} != ${definition.map.sha256}`);
      }
      const input = {
        id: definition.id,
        absolutePath,
        sha256: inputHash,
      };
      const { format, outputRecords } = createVariants(
        ktx,
        input,
        definition.map.colorSpace,
        definition.channels,
        previousImages.get(definition.id),
      );
      const decoded = {};
      for (const variantName of ["etc1s", "uastc"]) {
        const decodedPath = path.join(reviewRoot, `${definition.id}-${variantName}.png`);
        runKtx(ktx, [
          "extract", "--transcode", "rgba8",
          path.join(root, "assets", outputRecords[variantName].file),
          decodedPath,
        ], { allowOutput: false });
        decoded[variantName] = decodedPath;
      }
      const record = {
        id: definition.id,
        file: definition.map.file,
        inputBytes: statSync(absolutePath).size,
        inputSha256: inputHash,
        colorSpace: definition.map.colorSpace,
        channels: definition.channels,
        format,
        variants: outputRecords,
      };
      images.push(record);
      pilot.images = images;
      manifest.ktx2Pilot = pilot;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      reviewEntries.push({
        id: definition.id,
        label: definition.id.replaceAll("-", " "),
        channels: definition.channels,
        source: absolutePath,
        decoded,
      });
    }

    const reviewManifest = path.join(reviewRoot, "inputs.json");
    const metricsPath = path.join(reviewRoot, "metrics.json");
    writeFileSync(reviewManifest, JSON.stringify(reviewEntries, null, 2), "utf8");
    const python = process.platform === "win32" ? "python" : "python3";
    const reviewResult = spawnSync(python, [
      "scripts/render-ktx2-review.py",
      "--inputs-json", reviewManifest,
      "--output-dir", outputRoot,
      "--metrics-json", metricsPath,
    ], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    if (reviewResult.error) throw reviewResult.error;
    if (reviewResult.status !== 0) {
      throw new Error(`KTX review renderer failed (${reviewResult.status}):\n${reviewResult.stdout}\n${reviewResult.stderr}`);
    }
    process.stdout.write(`${reviewResult.stdout ?? ""}`);
    const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
    for (const image of images) image.qualityMetrics = metrics[image.id];

    pilot.images = images;
    pilot.status = "complete";
    manifest.ktx2Pilot = pilot;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeComparison(pilot);
    process.stdout.write(`\nKTX2 pilot complete: ${images.length} maps × 2 encodings.\n`);
  } finally {
    rmSync(reviewRoot, { recursive: true, force: true });
  }
}

main();
