import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetManifestPath = path.join(root, "assets", "manifest.json");
const outputRoot = path.join(root, "assets", "processed", "ktx2", "runtime");
const publicTextureRoot = path.join(root, "public", "textures", "ktx2");
const publicDecoderRoot = path.join(root, "public", "decoders", "basis");
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
  const ktx = resolveKtx();
  const version = run(ktx, ["--version"], { allowOutput: false });
  if (!version.includes(EXPECTED_KTX_VERSION)) {
    throw new Error(`Expected KTX-Software ${EXPECTED_KTX_VERSION}; received ${version || "no version output"}`);
  }

  const threePackagePath = path.join(root, "node_modules", "three", "package.json");
  const threePackage = JSON.parse(readFileSync(threePackagePath, "utf8"));
  if (threePackage.version !== EXPECTED_THREE_VERSION) {
    throw new Error(`Expected Three.js ${EXPECTED_THREE_VERSION}; received ${threePackage.version}`);
  }
  const basisSource = path.join(root, "node_modules", "three", "examples", "jsm", "libs", "basis");
  const decoderNames = ["basis_transcoder.js", "basis_transcoder.wasm", "README.md"];
  mkdirSync(publicDecoderRoot, { recursive: true });
  const decoderFiles = {};
  for (const name of decoderNames) {
    const sourcePath = path.join(basisSource, name);
    const targetPath = path.join(publicDecoderRoot, name);
    copyFileSync(sourcePath, targetPath);
    decoderFiles[name] = {
      file: path.posix.join("decoders/basis", name),
      bytes: statSync(targetPath).size,
      sha256: sha256(targetPath),
    };
  }
  const licensePath = path.join(root, "assets", "licenses", "Basis-Universal-LICENSE.txt");
  const publicLicensePath = path.join(publicDecoderRoot, "LICENSE.txt");
  copyFileSync(licensePath, publicLicensePath);
  decoderFiles["LICENSE.txt"] = {
    file: path.posix.join("decoders/basis", "LICENSE.txt"),
    bytes: statSync(publicLicensePath).size,
    sha256: sha256(publicLicensePath),
  };

  const manifest = JSON.parse(readFileSync(assetManifestPath, "utf8"));
  const textureRecords = [];
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
      const mipPaths = createMipChain(
        sourcePath,
        path.join(mipRoot, map.id),
        expectedMipLevels,
        map.mipmapWrapS,
      );
      const variants = {};
      for (const variant of ["etc1s", "uastc"]) {
        variants[variant] = encodeVariant(
          ktx,
          { ...map, resolutionPx: source.resolutionPx, colorSpace: source.colorSpace },
          variant,
          mipPaths,
          sourceSha256,
        );
      }

      const selected = variants[SELECTED_CODEC];
      const publicName = `${map.id}.ktx2`;
      const publicPath = path.join(publicTextureRoot, publicName);
      mkdirSync(publicTextureRoot, { recursive: true });
      copyFileSync(path.join(root, "assets", selected.file), publicPath);
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
  const layoutPath = path.join(publicTextureRoot, "facade-near-layout.json");
  const layout = {
    resolutionPx: nearAtlas.resolutionPx,
    materialRects: nearAtlas.materialRects,
    grid: nearAtlas.grid,
    gutterPx: nearAtlas.gutterPx,
    mipSafeLevelsApprox: nearAtlas.mipSafeLevelsApprox,
  };
  const layoutBytes = Buffer.from(JSON.stringify(layout, null, 2) + "\n", "utf8");
  writeFileSync(layoutPath, layoutBytes);
  const layoutRecord = {
    file: "textures/ktx2/facade-near-layout.json",
    bytes: layoutBytes.byteLength,
    sha256: createHash("sha256").update(layoutBytes).digest("hex"),
  };
  manifest.runtimeKtx2 = {
    revision: "stage3.6-quality-atlas-r1",
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
      decoderPath: "public/decoders/basis/",
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
