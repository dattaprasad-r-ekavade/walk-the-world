/**
 * Probe GPU / device tier and map to a quality preset (16.3).
 * Uses WEBGL_debug_renderer_info when available, plus coarse device hints.
 */

const LOW_GPU =
  /SwiftShader|llvmpipe|Microsoft Basic|Mali-4|Adreno \(TM\) [1-4]\b|PowerVR|Intel.*(HD|UHD) Graphics [1-5]\d{2}\b|Intel HD Graphics/i;
const MID_MOBILE =
  /Adreno \(TM\) [56]\d{2}|Mali-G[5-7]\d|Apple A1[0-3]|Apple GPU/i;

/**
 * @param {import('three').WebGLRenderer | null} [renderer]
 * @returns {'low' | 'medium' | 'high'}
 */
export function detectGpuQuality(renderer = null) {
  let gpu = "";
  try {
    const gl =
      renderer?.getContext?.() ||
      document.createElement("canvas").getContext("webgl") ||
      document.createElement("canvas").getContext("experimental-webgl");
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "");
    }
  } catch {
    /* ignore */
  }

  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  const mem = (typeof navigator !== "undefined" && navigator.deviceMemory) || 0;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  if (LOW_GPU.test(gpu) || cores <= 2 || (mem > 0 && mem <= 2)) return "low";
  if (isMobile) {
    if (MID_MOBILE.test(gpu) || (mem > 0 && mem <= 4) || cores <= 4) return "medium";
    return "medium"; // phones: never auto-pick high (shadows + SSAO + population)
  }
  if (/Intel/i.test(gpu) && !/Arc|Xe/i.test(gpu)) return "medium";
  if (dpr >= 2.5 && cores <= 6) return "medium";
  return "high";
}

/** Apply auto quality once if the user has not locked a manual preset. */
export function applyAutoQuality(getSettings, changeSetting, renderer = null) {
  const s = getSettings?.() || {};
  if (s.qualityMode === "manual") return s.quality || "medium";
  const q = detectGpuQuality(renderer);
  changeSetting?.({ quality: q, qualityMode: "auto" });
  return q;
}
