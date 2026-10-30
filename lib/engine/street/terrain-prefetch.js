import { lon2tx, lat2ty } from "@/lib/engine/geo";
import { STREET } from "./constants";

// Kept free of three.js so the /street page can import it without pulling the
// engine into its own chunk.

export const terrariumTileUrl = (z, tx, ty) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;

export function spawnTerrainTileKey(lat0, lon0) {
  const Z = STREET.TERRAIN_Z;
  return `${Math.floor(lon2tx(lon0, Z))}/${Math.floor(lat2ty(lat0, Z))}`;
}

const IMAGE_TIMEOUT_MS = 10000;

/**
 * CORS image load with a 10 s timeout; `signal` is optional. Resolves to an
 * ImageBitmap where the browser supports it: createImageBitmap decodes the
 * PNG off the main thread, whereas an <img> decodes lazily inside the first
 * drawImage and can stall a frame for several hundred ms on weak CPUs. Both
 * results work with drawImage.
 */
export function loadCorsImage(url, signal) {
  if (typeof createImageBitmap === "function" && typeof fetch === "function") return loadCorsBitmap(url, signal);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const finish = (error) => {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      img.onload = img.onerror = null;
      if (error) { img.src = ""; reject(error); } else resolve(img);
    };
    const abort = () => finish(new Error("Terrain image cancelled"));
    const timer = setTimeout(abort, IMAGE_TIMEOUT_MS);
    img.onload = () => finish(); img.onerror = () => finish(new Error("Terrain image failed"));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort(); else img.src = url;
  });
}

async function loadCorsBitmap(url, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, IMAGE_TIMEOUT_MS);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("Terrain image cancelled");
    const response = await fetch(url, { mode: "cors", signal: controller.signal });
    if (!response.ok) throw new Error("Terrain image failed");
    const blob = await response.blob();
    // Heights are encoded in raw RGB, so skip colour management and alpha
    // premultiplication; map tiles are opaque sRGB and are unaffected.
    return await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  } catch (error) {
    throw controller.signal.aborted ? new Error("Terrain image cancelled") : error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Frees a decoded ImageBitmap once drawn; a no-op for <img> results. */
export function releaseImage(image) {
  if (typeof image?.close === "function") image.close();
}

let pending = null;

/**
 * Start the spawn tile's elevation request from the /street page, while the
 * engine chunk is still downloading. The engine's first height load of that
 * tile takes it over with takeSpawnTerrainPrefetch instead of asking again.
 */
export function prefetchSpawnTerrain(lat0, lon0) {
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) return;
  if (typeof Image === "undefined" && typeof createImageBitmap !== "function") return;
  const key = spawnTerrainTileKey(lat0, lon0);
  if (pending?.key === key) return;
  const [tx, ty] = key.split("/").map(Number);
  const image = loadCorsImage(terrariumTileUrl(STREET.TERRAIN_Z, tx, ty));
  image.catch(() => {}); // the engine handles failure; avoid an unhandled rejection meanwhile
  pending = { key, image };
}

/** Single use: returns the pending image promise for `key` (or null) and forgets it. */
export function takeSpawnTerrainPrefetch(key) {
  if (!pending || pending.key !== key) return null;
  const { image } = pending;
  pending = null;
  return image;
}
