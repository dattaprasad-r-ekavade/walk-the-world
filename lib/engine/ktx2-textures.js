import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { markPerf, markPerfMeasurementUnavailable, recordPerfTiming } from "@/lib/perf";

const RUNTIME_TEXTURES = [
  { id: "facade-basecolor", url: "/textures/ktx2/facade-basecolor.ktx2" },
  { id: "facade-emissive", url: "/textures/ktx2/facade-emissive.ktx2" },
];

function parseTexture(loader, buffer) {
  return new Promise((resolve, reject) => loader.parse(buffer, resolve, reject));
}

function decoderResourceBytes(entries) {
  return (entries || [])
    .filter((entry) => entry.name.includes("/decoders/basis/"))
    .reduce((sum, entry) => sum + (entry.transferSize || entry.decodedBodySize || 0), 0);
}

export function createKtx2BuildingTextureLoader(renderer, { signal, onReady, onError } = {}) {
  const workerLimit = 2;
  const loader = new KTX2Loader()
    .setTranscoderPath("/decoders/basis/")
    .setWorkerLimit(workerLimit)
    .detectSupport(renderer);
  let disposed = false;
  let loaderDisposed = false;
  let initPromise = null;

  const disposeLoader = () => {
    if (loaderDisposed) return;
    loaderDisposed = true;
    if (initPromise) {
      initPromise.finally(() => loader.dispose()).catch(() => {});
    } else {
      loader.dispose();
    }
  };

  const load = async () => {
    const capabilities = { ...loader.workerConfig };
    markPerf("ktx2-support-detected", { workerLimit, capabilities });
    const resourceStart = performance.getEntriesByType("resource").length;
    const initStartedAt = performance.now();
    initPromise = loader.init();
    await initPromise;
    const decoderResources = performance.getEntriesByType("resource").slice(resourceStart);
    const decoderBytes = decoderResourceBytes(decoderResources);
    recordPerfTiming("ktx2.decoder-resources", performance.now() - initStartedAt, {
      bytes: decoderBytes,
      workerLimit,
    });

    const transferStartedAt = performance.now();
    const files = await Promise.all(RUNTIME_TEXTURES.map(async (texture) => {
      const response = await fetch(texture.url, { signal, cache: "force-cache" });
      if (!response.ok) throw new Error(`${texture.id} returned HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      return { ...texture, buffer };
    }));
    const transferMs = performance.now() - transferStartedAt;
    const transferBytes = files.reduce((sum, file) => sum + file.buffer.byteLength, 0);
    recordPerfTiming("ktx2.texture-transfer", transferMs, { bytes: transferBytes, count: files.length });
    markPerf("ktx2-transfer-complete", { bytes: transferBytes, count: files.length });

    const decodeStartedAt = performance.now();
    const parseResults = await Promise.allSettled(files.map(async (file) => ({
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
    recordPerfTiming("ktx2.worker-start-compile-transcode", decodeMs, {
      count: parsed.length,
      workerLimit,
      compileAndTranscodeCombined: true,
    });
    markPerfMeasurementUnavailable(
      "ktx2WasmCompileMs",
      "Three.js 0.170.0 compiles Basis WASM inside KTX2Loader workers; its public API does not expose compile and transcode timings separately.",
    );

    if (disposed || signal?.aborted) {
      for (const { texture } of parsed) texture.dispose();
      return null;
    }

    const textures = {};
    for (const { id, texture } of parsed) {
      if (texture.image.width !== 512 || texture.image.height !== 1024) {
        for (const pending of parsed) pending.texture.dispose();
        throw new Error(`${id} decoded to unexpected dimensions ${texture.image.width}×${texture.image.height}`);
      }
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      // CanvasTexture flips its top-left canvas data during upload. Compressed
      // textures cannot flip in WebGL, so mirror V in the texture transform.
      texture.repeat.y = -1;
      texture.offset.y = 1;
      textures[id] = texture;
    }

    try {
      onReady?.({
        facade: textures["facade-basecolor"],
        emissive: textures["facade-emissive"],
        transferMs,
        transferBytes,
        decodeMs,
        decoderBytes,
        mipLevels: Object.fromEntries(parsed.map(({ id, texture }) => [id, texture.mipmaps.length])),
        transcodeFormats: {
          facade: textures["facade-basecolor"].format,
          emissive: textures["facade-emissive"].format,
        },
        estimatedGpuBytes: parsed.reduce((sum, { texture }) =>
          sum + texture.mipmaps.reduce((mipSum, mip) => mipSum + mip.data.byteLength, 0), 0),
      });
    } catch (error) {
      for (const texture of Object.values(textures)) texture.dispose();
      throw error;
    }
    return textures;
  };

  const promise = load()
    .catch((error) => {
      if (!disposed && error?.name !== "AbortError") {
        markPerf("ktx2-fallback-active", { reason: error?.message || String(error) });
        onError?.(error);
      }
      return null;
    })
    .finally(disposeLoader);

  return {
    promise,
    dispose() {
      disposed = true;
      disposeLoader();
    },
  };
}
