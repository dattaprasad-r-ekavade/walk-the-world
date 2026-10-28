import {
  BASIS_TRANSCODER_PATH,
  RUNTIME_LAYOUT_URL,
  RUNTIME_TEXTURE_URLS,
} from "@/lib/engine/runtime-texture-assets";

/**
 * Revert switch: when true, desktop medium-tier devices that support a
 * compressed texture format also load the facade-near set (~6.3 MB compressed
 * GPU memory, plan.md 3.6). Set to false to restore high-only behaviour.
 */
export const ALLOW_NEAR_TEXTURES_ON_MEDIUM_DESKTOP = true;

export function isMobileUserAgent(ua = "") {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
}

/** workerConfig is KTX2Loader.workerConfig (null before detectSupport). */
export function hasCompressedFormatSupport(workerConfig) {
  if (!workerConfig) return false;
  return !!(workerConfig.astcSupported || workerConfig.etc2Supported ||
    workerConfig.dxtSupported || workerConfig.bptcSupported);
}

/** Decide whether the facade-near set should be loaded for a tier. Low never does. */
export function shouldUseNearTextures({ quality, isMobile = false, workerConfig = null } = {}) {
  if (quality === "high") return true;
  return ALLOW_NEAR_TEXTURES_ON_MEDIUM_DESKTOP &&
    quality === "medium" && !isMobile && hasCompressedFormatSupport(workerConfig);
}

/** Shared (non-near) files plus layout; the Basis decoder files are added by the caller. */
export function sharedPrefetchUrls() {
  return [RUNTIME_TEXTURE_URLS["facade-basecolor"], RUNTIME_TEXTURE_URLS["facade-emissive"]];
}

export function nearPrefetchUrls() {
  return [
    RUNTIME_TEXTURE_URLS["facade-near-basecolor"],
    RUNTIME_TEXTURE_URLS["facade-near-normal"],
    RUNTIME_TEXTURE_URLS["facade-near-roughness"],
    RUNTIME_TEXTURE_URLS["facade-near-emissive"],
    RUNTIME_LAYOUT_URL,
  ];
}

export function basisDecoderUrls() {
  return ["basis_transcoder.js", "basis_transcoder.wasm"].map((f) => BASIS_TRANSCODER_PATH + f);
}

/** Menu-time prefetch list: shared set + Basis decoder only (near set is ~6 MB, left to the engine). */
export function menuPrefetchUrls() {
  return [...sharedPrefetchUrls(), ...basisDecoderUrls()].filter(Boolean);
}

/** Skip on Save-Data and on coarse-pointer devices with slow connections. */
export function shouldPrefetchKtx2({ saveData = false, effectiveType = "", coarsePointer = false } = {}) {
  if (saveData) return false;
  if (coarsePointer && /^(slow-2g|2g|3g)$/.test(effectiveType)) return false;
  return true;
}

export function prefetchKtx2Assets(env = globalThis) {
  const nav = env.navigator;
  if (!nav || typeof env.fetch !== "function") return [];
  const conn = nav.connection || {};
  const coarsePointer = !!env.matchMedia?.("(pointer: coarse)")?.matches;
  if (!shouldPrefetchKtx2({ saveData: !!conn.saveData, effectiveType: conn.effectiveType || "", coarsePointer })) return [];
  const urls = menuPrefetchUrls();
  for (const url of urls) {
    // Same cache mode as the loader's fetch so the HTTP cache entry is reused.
    env.fetch(url, { priority: "low", cache: "force-cache" })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }
  return urls;
}
