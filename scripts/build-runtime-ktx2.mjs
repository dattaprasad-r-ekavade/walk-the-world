import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetManifestPath = path.join(root, "assets", "manifest.json");
const outputRoot = path.join(root, "assets", "processed", "ktx2", "runtime");
const publicTextureRoot = path.join(root, "public", "textures", "ktx2");
const publicDecoderBaseRoot = path.join(root, "public", "decoders", "basis");
const runtimeManifestPath = path.join(publicTextureRoot, "runtime-manifest.json");
const runtimeAssetModulePath = path.join(root, "lib", "engine", "runtime-texture-assets.js");
const serviceWorkerPath = path.join(root, "public", "sw.js");
const EXPECTED_KTX_VERSION = "v4.4.2";
const EXPECTED_THREE_VERSION = "0.170.0";
const EXPECTED_PILLOW_VERSION = "10.4.0";
const KTX_RELEASE_URL = "https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2";
const SELECTED_CODEC = "uastc";
const MAPS = [
  { id: "facade-basecolor", tier: "shared", key: "facade", mipmapWrapS: "repeat" },
  { id: "facade-emissive", tier: "shared", key: "emissive", mipmapWrapS: "repeat" },
  { id: "facade-near-basecolor", tier: "high", key: "basecolor", mipmapWrapS: "clamp" },
  { id: "facade-near-normal", tier: "high", key: "normal", mipmapWrapS: "clamp", rdoLambda: 0.5 },
  { id: "facade-near-roughness", tier: "high", key: "roughness", mipmapWrapS: "clamp" },
  { id: "facade-near-emissive", tier: "high", key: "emissive", mipmapWrapS: "clamp" },
];

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(program, args, { allowOutput = true } = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    throw new Error(`${program} failed (${result.status}): ${args.join(" ")}\n${output}`);
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

function mipLevelCount([width, height]) {
  return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

function createMipChain(sourcePath, outputDirectory, expectedLevels, wrapS) {
  const python = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
  const script = path.join(root, "scripts", "build-runtime-mip-chain.py");
  const output = run(python, [script, sourcePath, outputDirectory, wrapS], { allowOutput: false });
  const mipPaths = JSON.parse(output);
  if (!Array.isArray(mipPaths) || mipPaths.length !== expectedLevels) {
    throw new Error(`Expected ${expectedLevels} mip images for ${path.basename(sourcePath)}; got ${mipPaths?.length ?? "invalid output"}`);
  }
  return mipPaths;
}

function encodeVariant(ktx, map, variant, mipPaths, sourceSha256) {
  const expectedMipLevels = mipLevelCount(map.resolutionPx);
  const relativePath = path.posix.join("processed/ktx2/runtime", variant, `${map.id}.ktx2`);
  const outputPath = path.join(root, "assets", relativePath);
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const srgb = map.colorSpace === "sRGB";
  const rdoLambda = map.rdoLambda ?? 1;
  const format = `R8G8B8A8_${srgb ? "SRGB" : "UNORM"}`;
  const common = [
    "--format", format,
    "--assign-tf", srgb ? "srgb" : "linear",
    "--assign-primaries", srgb ? "srgb" : "none",
    "--assign-texcoord-origin", "top-left",
    "--threads", "1",
    "--levels", String(expectedMipLevels),
  ];
  const codecArgs = variant === "uastc"
    ? ["--encode", "uastc", "--uastc-quality", "2", "--uastc-rdo", "--uastc-rdo-l", String(rdoLambda), "--uastc-rdo-m", "--zstd", "18"]
    : ["--encode", "basis-lz", "--clevel", "1", "--qlevel", "128"];

  const comparison = run(ktx, ["create", ...common, ...codecArgs, "--compare-psnr", ...mipPaths, outputPath]);
  run(ktx, ["validate", "--gltf-basisu", outputPath], { allowOutput: false });
  const info = JSON.parse(run(ktx, ["info", "--format", "json", outputPath], { allowOutput: false }));
  if (!info.valid || info.header?.levelCount !== expectedMipLevels) {
    throw new Error(
      `${map.id} ${variant} has ${info.header?.levelCount ?? "unknown"} mip levels; expected ${expectedMipLevels}`,
    );
  }
  const psnr = comparison.match(/PSNR Max:\s*([\d.]+)/i)?.[1];
  return {
    file: relativePath,
    bytes: statSync(outputPath).size,
    sha256: sha256(outputPath),
    psnrMaxDb: psnr ? Number(psnr) : null,
    settings: variant === "uastc"
      ? {
          encode: "uastc",
          quality: 2,
          rdoLambda,
          rdoMultithreading: false,
          zstd: 18,
          mipLevels: expectedMipLevels,
          mipmapFilter: "pillow-lanczos",
          mipmapWrapS: map.mipmapWrapS,
          mipmapWrapT: "clamp",
        }
      : {
          encode: "basis-lz",
          clevel: 1,
          qlevel: 128,
          mipLevels: expectedMipLevels,
          mipmapFilter: "pillow-lanczos",
          mipmapWrapS: map.mipmapWrapS,
          mipmapWrapT: "clamp",
        },
    sourceSha256,
    format,
    texcoordOrigin: "top-left",
    runtimeUvTransform: "flip-v-to-match-canvas-texture",
  };
}

function main() {
  const reuseExisting = process.argv.includes("--reuse-existing");
  const manifest = JSON.parse(readFileSync(assetManifestPath, "utf8"));
  let ktx = null;
  if (reuseExisting) {
    if (!Array.isArray(manifest.runtimeKtx2?.textures) || !manifest.runtimeKtx2.textures.length) {
      throw new Error("--reuse-existing requires runtimeKtx2 entries in assets/manifest.json");
    }
  } else {
    ktx = resolveKtx();
    const version = run(ktx, ["--version"], { allowOutput: false });
    if (!version.includes(EXPECTED_KTX_VERSION)) {
      throw new Error(`Expected KTX-Software ${EXPECTED_KTX_VERSION}; received ${version || "no version output"}`);
    }
  }

  const threePackagePath = path.join(root, "node_modules", "three", "package.json");
  const threePackage = JSON.parse(readFileSync(threePackagePath, "utf8"));
  if (threePackage.version !== EXPECTED_THREE_VERSION) {
    throw new Error(`Expected Three.js ${EXPECTED_THREE_VERSION}; received ${threePackage.version}`);
  }
  const basisSource = path.join(root, "node_modules", "three", "examples", "jsm", "libs", "basis");
  const decoderNames = ["basis_transcoder.js", "basis_transcoder.wasm", "README.md"];
  const previousDecoderFiles = manifest.runtimeKtx2?.decoderFiles ?? {};
  const decoderSourceFiles = Object.fromEntries(decoderNames.map((name) => [
    name,
    reuseExisting && previousDecoderFiles[name]?.file
      ? path.join(root, "public", ...previousDecoderFiles[name].file.split("/"))
      : path.join(basisSource, name),
  ]));
  const licensePath = path.join(root, "assets", "licenses", "Basis-Universal-LICENSE.txt");
  decoderSourceFiles["LICENSE.txt"] = reuseExisting && previousDecoderFiles["LICENSE.txt"]?.file
    ? path.join(root, "public", ...previousDecoderFiles["LICENSE.txt"].file.split("/"))
    : licensePath;
  const decoderHashes = Object.fromEntries(Object.entries(decoderSourceFiles).map(([name, sourcePath]) => [
    name,
    sha256(sourcePath),
  ]));
  const decoderRevision = createHash("sha256")
    .update(Object.keys(decoderHashes).sort().map((name) => `${name}:${decoderHashes[name]}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  const publicDecoderRoot = path.join(publicDecoderBaseRoot, decoderRevision);
  mkdirSync(publicDecoderRoot, { recursive: true });
  const decoderFiles = {};
  for (const [name, sourcePath] of Object.entries(decoderSourceFiles)) {
    const targetPath = path.join(publicDecoderRoot, name);
    if (path.resolve(sourcePath) !== path.resolve(targetPath)) copyFileSync(sourcePath, targetPath);
    decoderFiles[name] = {
      file: path.posix.join("decoders/basis", decoderRevision, name),
      bytes: statSync(targetPath).size,
      sha256: decoderHashes[name],
    };
  }

  const textureRecords = [];
  const previousTextures = new Map((manifest.runtimeKtx2?.textures ?? []).map((texture) => [texture.id, texture]));
  const mipRoot = mkdtempSync(path.join(os.tmpdir(), "walk-the-world-runtime-mips-"));
  try {
    for (const map of MAPS) {
      const source = map.tier === "high"
        ? manifest.facadeAtlases?.packed?.maps?.[map.key]
        : manifest.facadeAtlases?.maps?.[map.key];
      if (!source?.file) throw new Error(`Missing facade source map: ${map.key}`);
      const sourcePath = path.join(root, "assets", source.file);
      const sourceSha256 = sha256(sourcePath);
      if (source.sha256 && source.sha256 !== sourceSha256) {
        throw new Error(`Facade source hash mismatch for ${map.id}: ${sourceSha256} != ${source.sha256}`);
      }

      const expectedMipLevels = mipLevelCount(source.resolutionPx);
      let variants;
      let selected;
      let publicSourcePath;
      if (reuseExisting) {
        const previous = previousTextures.get(map.id);
        if (!previous?.runtime?.file || !previous.variants?.[SELECTED_CODEC]) {
          throw new Error(`Missing existing runtime ${SELECTED_CODEC} texture for ${map.id}`);
        }
        publicSourcePath = path.join(root, "public", ...previous.runtime.file.split("/"));
        if (!existsSync(publicSourcePath) || sha256(publicSourcePath) !== previous.runtime.sha256) {
          throw new Error(`Existing runtime texture hash mismatch for ${map.id}`);
        }
        variants = previous.variants;
        selected = { ...variants[SELECTED_CODEC], sha256: previous.runtime.sha256 };
      } else {
        const mipPaths = createMipChain(
          sourcePath,
          path.join(mipRoot, map.id),
          expectedMipLevels,
          map.mipmapWrapS,
        );
        variants = {};
        for (const variant of ["etc1s", "uastc"]) {
          variants[variant] = encodeVariant(
            ktx,
            { ...map, resolutionPx: source.resolutionPx, colorSpace: source.colorSpace },
            variant,
            mipPaths,
            sourceSha256,
          );
        }
        selected = variants[SELECTED_CODEC];
        publicSourcePath = path.join(root, "assets", selected.file);
      }

      const publicName = `${map.id}.${selected.sha256.slice(0, 16)}.ktx2`;
      const publicPath = path.join(publicTextureRoot, publicName);
      mkdirSync(publicTextureRoot, { recursive: true });
      if (path.resolve(publicSourcePath) !== path.resolve(publicPath)) copyFileSync(publicSourcePath, publicPath);
      textureRecords.push({
        id: map.id,
        tier: map.tier,
        source: source.file,
        sourceSha256,
        resolutionPx: source.resolutionPx,
        colorSpace: source.colorSpace,
        variants,
        selectedCodec: SELECTED_CODEC,
        runtime: {
          file: path.posix.join("textures/ktx2", publicName),
          bytes: statSync(publicPath).size,
          sha256: sha256(publicPath),
          mipLevels: expectedMipLevels,
          texcoordOrigin: "top-left",
          runtimeUvTransform: "flip-v-to-match-canvas-texture",
        },
      });
    }
  } finally {
    rmSync(mipRoot, { recursive: true, force: true });
  }

  const runtimeMipLevels = Math.max(...textureRecords.map((texture) => mipLevelCount(texture.resolutionPx)));
  const nearAtlas = manifest.facadeAtlases?.packed;
  if (!nearAtlas?.materialRects || !nearAtlas.resolutionPx) {
    throw new Error("Missing packed facade atlas layout for the high quality tier");
  }
  const layout = {
    resolutionPx: nearAtlas.resolutionPx,
    materialRects: nearAtlas.materialRects,
    grid: nearAtlas.grid,
    gutterPx: nearAtlas.gutterPx,
    mipSafeLevelsApprox: nearAtlas.mipSafeLevelsApprox,
  };
  const layoutBytes = Buffer.from(JSON.stringify(layout, null, 2) + "\n", "utf8");
  const layoutSha256 = sha256Bytes(layoutBytes);
  const layoutName = `facade-near-layout.${layoutSha256.slice(0, 16)}.json`;
  const layoutPath = path.join(publicTextureRoot, layoutName);
  writeFileSync(layoutPath, layoutBytes);
  const layoutRecord = {
    file: path.posix.join("textures/ktx2", layoutName),
    bytes: layoutBytes.byteLength,
    sha256: layoutSha256,
  };
  const revisionParts = [
    ...textureRecords.map(({ runtime }) => `${runtime.file}:${runtime.sha256}`),
    `${layoutRecord.file}:${layoutRecord.sha256}`,
    ...Object.entries(decoderFiles).map(([name, file]) => `${file.file}:${file.sha256}`),
  ].sort();
  const assetRevision = createHash("sha256").update(revisionParts.join("\n")).digest("hex").slice(0, 16);
  const decoderPath = path.posix.join("/decoders/basis", decoderRevision, "/");
  const runtimeManifest = {
    schemaVersion: 1,
    revision: assetRevision,
    decoderPath,
    decoderFiles,
    textures: Object.fromEntries(textureRecords.map((texture) => [texture.id, {
      tier: texture.tier,
      file: texture.runtime.file,
      bytes: texture.runtime.bytes,
      sha256: texture.runtime.sha256,
    }])),
    nearAtlasLayout: layoutRecord,
  };
  writeFileSync(runtimeManifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`, "utf8");

  const textureUrls = Object.fromEntries(textureRecords.map((texture) => [
    texture.id,
    `/${texture.runtime.file}`,
  ]));
  const runtimeAssetModule = [
    "// Generated by scripts/build-runtime-ktx2.mjs; do not edit by hand.",
    `export const RUNTIME_TEXTURE_REVISION = ${JSON.stringify(assetRevision)};`,
    `export const BASIS_TRANSCODER_PATH = ${JSON.stringify(decoderPath)};`,
    `export const RUNTIME_TEXTURE_URLS = Object.freeze(${JSON.stringify(textureUrls, null, 2)});`,
    `export const RUNTIME_LAYOUT_URL = ${JSON.stringify(`/${layoutRecord.file}`)};`,
    "",
  ].join("\n");
  writeFileSync(runtimeAssetModulePath, runtimeAssetModule, "utf8");

  const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
  const revisionPattern = /(const CACHE_REVISION = )["'][^"']*["'];/u;
  if (!revisionPattern.test(serviceWorker)) {
    throw new Error("public/sw.js is missing the generated CACHE_REVISION declaration");
  }
  writeFileSync(
    serviceWorkerPath,
    serviceWorker.replace(revisionPattern, `$1${JSON.stringify(assetRevision)};`),
    "utf8",
  );
  manifest.runtimeKtx2 = {
    revision: `stage3.8-content-${assetRevision}`,
    assetRevision,
    toolchain: {
      name: "KTX-Software",
      version: EXPECTED_KTX_VERSION,
      releaseUrl: KTX_RELEASE_URL,
    },
    mipGenerator: {
      name: "Pillow",
      version: EXPECTED_PILLOW_VERSION,
      filter: "Lanczos",
      wrapS: "per-map; repeat for shared textures and clamp for high atlas",
      wrapT: "clamp",
    },
    runtime: {
      threeVersion: EXPECTED_THREE_VERSION,
      decoderPath: path.posix.join("public/decoders/basis", decoderRevision, "/"),
      workerLimit: 2,
      selectedCodec: SELECTED_CODEC,
      texcoordOrigin: "top-left",
      runtimeUvTransform: "flip-v-to-match-canvas-texture",
      mipLevels: runtimeMipLevels,
      mipmapGeneration: { method: "offline", filter: "pillow-lanczos", wrapS: "per-map", wrapT: "clamp" },
      textureTiers: {
        shared: ["facade-basecolor", "facade-emissive"],
        high: ["facade-near-basecolor", "facade-near-normal", "facade-near-roughness", "facade-near-emissive"],
      },
      fallback: "procedural makeFacadeAtlas/makeLitWindowAtlas",
    },
    nearAtlasLayout: layoutRecord,
    runtimeManifest: {
      file: "textures/ktx2/runtime-manifest.json",
      sha256: sha256(runtimeManifestPath),
      revision: assetRevision,
    },
    decoderFiles,
    textures: textureRecords,
  };
  writeFileSync(assetManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  process.stdout.write(`\nRuntime KTX2 maps ready (${SELECTED_CODEC}):\n`);
  for (const texture of textureRecords) {
    const etc = texture.variants.etc1s.bytes;
    const uas = texture.variants.uastc.bytes;
    process.stdout.write(`  ${texture.id}: ETC1S ${etc} B; UASTC ${uas} B; runtime ${texture.runtime.bytes} B\n`);
  }
  process.stdout.write(`Three.js ${EXPECTED_THREE_VERSION} Basis transcoder copied to public/decoders/basis/.\n`);
}

main();
