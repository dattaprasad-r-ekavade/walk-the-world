import { installBuildingNearTextureMaps, installBuildingTextureMaps } from "@/lib/engine/materials";
import { markPerf, recordPerfTiming, setPerfMetadata, setPerfResourceCounts } from "@/lib/perf";

/**
 * Uploads decoded KTX2 facade texture sets to the GPU, installs them on the
 * shared building materials, and keeps the estimated GPU-byte budget for the
 * shared (all tiers) and near (high tier only) sets.
 */
export function createKtx2Installer(renderer) {
  let sharedBytes = 0;
  let highBytes = 0;

  const reportCounts = () => setPerfResourceCounts({
    textures: renderer.info.memory.textures,
    ktx2EstimatedGpuBytes: sharedBytes + highBytes,
    ktx2SharedEstimatedGpuBytes: sharedBytes,
    ktx2HighEstimatedGpuBytes: highBytes,
  });

  /** @returns {boolean} whether the set was installed (false disposes it). */
  const install = (maps) => {
    const high = maps.tier === "high";
    const textures = Object.values(maps.textures);
    const textureCountBefore = renderer.info.memory.textures;
    const uploadStartedAt = performance.now();
    try {
      for (const texture of textures) renderer.initTexture(texture);
    } catch (error) {
      for (const texture of textures) texture.dispose();
      throw error;
    }
    const uploadSubmitMs = performance.now() - uploadStartedAt;
    const installed = high
      ? installBuildingNearTextureMaps({
          basecolor: maps.textures["facade-near-basecolor"],
          normal: maps.textures["facade-near-normal"],
          roughness: maps.textures["facade-near-roughness"],
          emissive: maps.textures["facade-near-emissive"],
          materialRects: maps.materialRects,
        })
      : installBuildingTextureMaps({
          facade: maps.textures["facade-basecolor"],
          emissive: maps.textures["facade-emissive"],
        });
    if (!installed) {
      for (const texture of textures) texture.dispose();
      return false;
    }

    if (high) highBytes = maps.estimatedGpuBytes;
    else sharedBytes = maps.estimatedGpuBytes;
    const textureCountDelta = renderer.info.memory.textures - textureCountBefore;
    recordPerfTiming(`${high ? "ktx2.high" : "ktx2"}.texture-upload-submit`, uploadSubmitMs, {
      bytes: maps.estimatedGpuBytes,
      textureCountDelta,
    });
    reportCounts();
    const details = {
      transcodeFormats: maps.transcodeFormats,
      transferBytes: maps.transferBytes,
      transferMs: maps.transferMs,
      decoderBytes: maps.decoderBytes,
      mipLevels: maps.mipLevels,
      workerLimit: 2,
      estimatedGpuBytes: maps.estimatedGpuBytes,
      estimatedTotalGpuBytes: sharedBytes + highBytes,
      textureCountDelta,
    };
    setPerfMetadata(high ? { ktx2High: details } : { ktx2: details });
    markPerf(high ? "ktx2-high-textures-ready" : "ktx2-textures-ready", {
      ...details,
      compileAndTranscodeMs: maps.decodeMs,
      uploadSubmitMs,
    });
    return true;
  };

  /** Book-keeping after the loader drops the near set (tier left high). */
  const releaseHigh = () => {
    if (highBytes <= 0) return;
    highBytes = 0;
    reportCounts();
    markPerf("ktx2-high-textures-released", { estimatedGpuBytes: sharedBytes });
  };

  return { install, releaseHigh };
}
