import { lat2ty, lon2tx, tx2lon, ty2lat } from "@/lib/engine/geo";

export const TERRARIUM_GRID_SIZE = 65;

export function decodeTerrariumHeightGrid(rgba, width = 256, height = 256, size = TERRARIUM_GRID_SIZE) {
  if (!rgba || rgba.length < width * height * 4 || !Number.isInteger(size) || size < 2) {
    throw new TypeError("Invalid Terrarium image pixels");
  }
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = Math.min(width - 1, Math.round((x / (size - 1)) * (width - 1)));
      const py = Math.min(height - 1, Math.round((y / (size - 1)) * (height - 1)));
      const offset = (py * width + px) * 4;
      heights[y * size + x] = rgba[offset] * 256 + rgba[offset + 1] + rgba[offset + 2] / 256 - 32768;
    }
  }
  return heights;
}

export function terrainTileLocalBounds(tx, ty, zoom, toLocal) {
  if (![tx, ty, zoom].every(Number.isInteger) || typeof toLocal !== "function") {
    throw new TypeError("Invalid terrain tile coordinates");
  }
  const tl = toLocal(ty2lat(ty, zoom), tx2lon(tx, zoom));
  const br = toLocal(ty2lat(ty + 1, zoom), tx2lon(tx + 1, zoom));
  return { tl, br, x0: tl.x, z0: tl.z, sizeX: br.x - tl.x, sizeZ: br.z - tl.z };
}

export function terrainTileKeysForCell(lat, lon, step, zoom, margin = 0) {
  if (![lat, lon, step, zoom, margin].every(Number.isFinite) || step <= 0 || zoom < 0 || margin < 0) {
    throw new TypeError("Invalid terrain tile range");
  }
  const west = Math.floor(lon2tx(lon - step / 2, zoom));
  const east = Math.floor(lon2tx(lon + step / 2, zoom));
  const north = Math.floor(lat2ty(lat + step / 2, zoom));
  const south = Math.floor(lat2ty(lat - step / 2, zoom));
  const keys = [];
  for (let ty = north - margin; ty <= south + margin; ty++) {
    for (let tx = west - margin; tx <= east + margin; tx++) keys.push(`${tx}/${ty}`);
  }
  return keys;
}

/** Canonical byte chunks for hashing the exact downsampled height grids used by the builder. */
export function terrainRevisionChunks(tiles) {
  const entries = tiles instanceof Map
    ? [...tiles.entries()].map(([key, tile]) => ({ key, ...tile }))
    : [...(tiles || [])];
  return entries
    .filter((tile) => typeof tile?.key === "string" && ArrayBuffer.isView(tile.heights))
    .sort((a, b) => a.key.localeCompare(b.key))
    .flatMap(({ key, heights }) => {
      const keyBytes = new TextEncoder().encode(key);
      const header = new Uint8Array(4 + keyBytes.byteLength);
      new DataView(header.buffer).setUint32(0, keyBytes.byteLength, true);
      header.set(keyBytes, 4);
      const values = new Uint8Array(heights.length * 4);
      const view = new DataView(values.buffer);
      for (let i = 0; i < heights.length; i++) view.setFloat32(i * 4, heights[i], true);
      return [header, values];
    });
}

export async function computeTerrainRevision(terrainTiles, keys, cryptoApi = globalThis.crypto, onTiming = null) {
  if (!Array.isArray(keys) || !keys.length || typeof cryptoApi?.subtle?.digest !== "function") return null;
  const tiles = [];
  for (const key of [...new Set(keys)].sort()) {
    const tile = terrainTiles instanceof Map ? terrainTiles.get(key) : null;
    if (!tile?.heights) return null;
    tiles.push({ key, heights: tile.heights });
  }
  const canTime = typeof onTiming === "function" && typeof globalThis.performance?.now === "function";
  const packStartedAt = canTime ? globalThis.performance.now() : 0;
  const chunks = terrainRevisionChunks(tiles);
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (canTime) onTiming("pack", globalThis.performance.now() - packStartedAt, { tileCount: tiles.length, byteLength });
  const digestStartedAt = canTime ? globalThis.performance.now() : 0;
  const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes));
  if (canTime) onTiming("digest", globalThis.performance.now() - digestStartedAt, { byteLength });
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}
