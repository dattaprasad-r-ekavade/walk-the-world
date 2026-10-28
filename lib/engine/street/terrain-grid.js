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
