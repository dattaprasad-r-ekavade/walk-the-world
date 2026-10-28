import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { markPerf, markPerfMeasurementUnavailable, recordPerfTiming } from "@/lib/perf";
import {
  BASIS_TRANSCODER_PATH,
  RUNTIME_LAYOUT_URL,
  RUNTIME_TEXTURE_URLS,
} from "@/lib/engine/runtime-texture-assets";

const SHARED_TEXTURES = [
  { id: "facade-basecolor", width: 512, height: 1024, colorSpace: "sRGB", wrapS: "repeat" },
  { id: "facade-emissive", width: 512, height: 1024, colorSpace: "sRGB", wrapS: "repeat" },
];
const HIGH_TEXTURES = [
  { id: "facade-near-basecolor", width: 1600, height: 2096, colorSpace: "sRGB", wrapS: "clamp" },
  { id: "facade-near-normal", width: 1600, height: 2096, colorSpace: "linear", wrapS: "clamp" },
  { id: "facade-near-roughness", width: 1600, height: 2096, colorSpace: "linear", wrapS: "clamp" },
  { id: "facade-near-emissive", width: 1600, height: 2096, colorSpace: "sRGB", wrapS: "clamp" },
];
const WORKER_LIMIT = 2;

function parseTexture(loader, buffer) {
  return new Promise((resolve, reject) => loader.parse(buffer, resolve, reject));
}

function decoderResourceBytes(entries) {
  return (entries || [])
    .filter((entry) => entry.name.includes("/decoders/basis/"))
    .reduce((sum, entry) => sum + (entry.transferSize || entry.decodedBodySize || 0), 0);
}

export function createKtx2BuildingTextureLoader(renderer, {
  signal,
  onSharedReady,
  onHighReady,
  onHighDispose,
  onError,
} = {}) {
  const loader = new KTX2Loader()
    .setTranscoderPath(BASIS_TRANSCODER_PATH)
    .setWorkerLimit(WORKER_LIMIT)
    .detectSupport(renderer);
  let disposed = false;
  let loaderDisposed = false;
  let quality = "medium";
  let walkingReady = false;
  let highLoaded = false;
  let highPayload = null;
  let highLoadPromise = null;
  const activeLoads = new Set();

  let initPromise = null;
  const initializeLoader = () => {
    if (!initPromise) {
      const resourceStart = performance.getEntriesByType("resource").length;
      const initStartedAt = performance.now();
      initPromise = loader.init().then(() => {
        const decoderResources = performance.getEntriesByType("resource").slice(resourceStart);
        const decoderBytes = decoderResourceBytes(decoderResources);
        const initMs = performance.now() - initStartedAt;
        recordPerfTiming("ktx2.decoder-resources", initMs, {
          bytes: decoderBytes,
          workerLimit: WORKER_LIMIT,
        });
        markPerfMeasurementUnavailable(
          "ktx2WasmCompileMs",
          "Three.js 0.170.0 compiles Basis WASM inside KTX2Loader workers; its public API does not expose compile and transcode timings separately.",
        );
        return { decoderBytes, initMs };
      });
    }
    return initPromise;
  };

  const disposeLoader = () => {
    if (loaderDisposed) return;
    loaderDisposed = true;
    Promise.allSettled([...activeLoads, ...(initPromise ? [initPromise] : [])]).finally(() => loader.dispose());
  };

  const releaseHighTextures = () => {
    if (!highPayload) return false;
    try {
      onHighDispose?.(highPayload);
    } finally {
      for (const texture of Object.values(highPayload.textures)) texture.dispose();
      highPayload = null;
      highLoaded = false;
    }
    return true;
  };

  const loadTextureSet = async (tier) => {
    await initializeLoader();
    if (disposed || signal?.aborted) return null;

    const definitions = tier === "high" ? HIGH_TEXTURES : SHARED_TEXTURES;
    const transferStartedAt = performance.now();
    const [downloadedFiles, layoutResponse] = await Promise.all([
      Promise.all(definitions.map(async (definition) => {
        const url = RUNTIME_TEXTURE_URLS[definition.id];
        if (!url) throw new Error("No content-addressed runtime URL for " + definition.id);
        const response = await fetch(url, { signal, cache: "force-cache" });
        if (!response.ok) throw new Error(definition.id + " returned HTTP " + response.status);
        return { ...definition, buffer: await response.arrayBuffer() };
      })),
      tier === "high"
        ? fetch(RUNTIME_LAYOUT_URL, { signal, cache: "force-cache" }).then(async (response) => {
            if (!response.ok) throw new Error("facade-near-layout returned HTTP " + response.status);
            const text = await response.text();
            return { text, bytes: new TextEncoder().encode(text).byteLength };
          })
        : Promise.resolve(null),
    ]);
    const transferMs = performance.now() - transferStartedAt;
    const transferBytes = downloadedFiles.reduce((sum, file) => sum + file.buffer.byteLength, 0) +
      (layoutResponse?.bytes || 0);
    const prefix = tier === "high" ? "ktx2.high" : "ktx2";
    recordPerfTiming(prefix + ".texture-transfer", transferMs, {
      bytes: transferBytes,
      count: downloadedFiles.length + (layoutResponse ? 1 : 0),
    });
    markPerf(tier === "high" ? "ktx2-high-transfer-complete" : "ktx2-transfer-complete", {
      bytes: transferBytes,
      count: downloadedFiles.length + (layoutResponse ? 1 : 0),
    });

    const decodeStartedAt = performance.now();
    const parseResults = await Promise.allSettled(downloadedFiles.map(async (file) => ({
      ...file,
      texture: await parseTexture(loader, file.buffer),
    })));
    const parseFailure = parseResults.find((result) => result.status === "rejected");
    if (parseFailure) {
      for (const result of parseResults) {
        if (result.status === "fulfilled") result.value.texture.dispose();
      }
      throw parseFailure.reason;
    }
    const parsed = parseResults.map((result) => result.value);
    const decodeMs = performance.now() - decodeStartedAt;
    recordPerfTiming(prefix + ".worker-start-compile-transcode", decodeMs, {
      count: parsed.length,
      workerLimit: WORKER_LIMIT,
      compileAndTranscodeCombined: true,
    });

    const disposeParsed = () => {
      for (const entry of parsed) entry.texture.dispose();
    };
    if (disposed || signal?.aborted) {
      disposeParsed();
      return null;
    }

    const textures = {};
    for (const { id, texture, width, height, colorSpace, wrapS } of parsed) {
      if (texture.image.width !== width || texture.image.height !== height) {
        disposeParsed();
        throw new Error(id + " decoded to unexpected dimensions " + texture.image.width + "×" + texture.image.height);
      }
      texture.wrapS = wrapS === "repeat" ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = colorSpace === "sRGB" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.anisotropy = Math.min(tier === "high" ? 16 : 8, renderer.capabilities.getMaxAnisotropy());
      // CanvasTexture flips its top-left canvas data during upload. Compressed
      // textures cannot flip in WebGL, so mirror V in the texture transform.
      texture.repeat.y = -1;
      texture.offset.y = 1;
      textures[id] = texture;
    }

    const payload = {
      tier,
      textures,
      transferMs,
      transferBytes,
      decodeMs,
      decoderBytes: (await initializeLoader()).decoderBytes,
      mipLevels: Object.fromEntries(parsed.map(({ id, texture }) => [id, texture.mipmaps.length])),
      transcodeFormats: Object.fromEntries(parsed.map(({ id, texture }) => [id, texture.format])),
      estimatedGpuBytes: parsed.reduce((sum, { texture }) =>
        sum + texture.mipmaps.reduce((mipSum, mip) => mipSum + mip.data.byteLength, 0), 0),
      materialRects: layoutResponse ? JSON.parse(layoutResponse.text).materialRects : null,
    };

    try {
      if (tier === "high") {
        if (quality !== "high") {
          disposeParsed();
          return null;
        }
        if (onHighReady?.(payload) === false) {
          disposeParsed();
          return null;
        }
        highPayload = payload;
        highLoaded = true;
      } else if (onSharedReady?.(payload) === false) {
        disposeParsed();
        return null;
      }
    } catch (error) {
      disposeParsed();
      throw error;
    }
    return payload;
  };

  const startLoad = (tier) => {
    const task = loadTextureSet(tier).catch((error) => {
      if (!disposed && error?.name !== "AbortError") {
        markPerf(tier === "high" ? "ktx2-high-fallback-active" : "ktx2-fallback-active", {
          reason: error?.message || String(error),
        });
        onError?.(error, tier);
      }
      return null;
    });
    activeLoads.add(task);
    task.finally(() => activeLoads.delete(task));
    return task;
  };

  let resolveSharedPromise;
  let sharedLoadPromise = new Promise((resolve) => {
    resolveSharedPromise = resolve;
  });
  let sharedLoadStarted = false;

  const startSharedLoadIfReady = () => {
    if (!walkingReady || sharedLoadStarted || disposed) return sharedLoadPromise;
    sharedLoadStarted = true;
    startLoad("shared").then(resolveSharedPromise);
    return sharedLoadPromise;
  };

  const startHighLoadIfReady = () => {
    if (quality === "high" && walkingReady && !highLoaded && !highLoadPromise && !disposed) {
      startSharedLoadIfReady();
      highLoadPromise = startLoad("high").finally(() => {
        highLoadPromise = null;
      });
    }
  };

  return {
    get promise() {
      return sharedLoadPromise;
    },
    setQuality(nextQuality) {
      quality = nextQuality === "high" ? "high" : "shared";
      if (quality !== "high") {
        releaseHighTextures();
        return;
      }
      startHighLoadIfReady();
    },
    setWalkingReady() {
      walkingReady = true;
      startSharedLoadIfReady();
      startHighLoadIfReady();
    },
    dispose() {
      disposed = true;
      if (!sharedLoadStarted) resolveSharedPromise(null);
      releaseHighTextures();
      disposeLoader();
    },
  };
}
