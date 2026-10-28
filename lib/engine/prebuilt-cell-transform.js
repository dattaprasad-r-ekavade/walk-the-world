import { makeLocalFrame } from "./geo";

function transformGeometry(geometry, scaleX, offsetX, offsetZ) {
  const position = geometry?.position;
  const positions = position?.array;
  if (ArrayBuffer.isView(positions) && Number.isInteger(position.itemSize) && position.itemSize >= 3) {
    for (let i = 0; i < positions.length; i += position.itemSize) {
      positions[i] = positions[i] * scaleX + offsetX;
      positions[i + 2] += offsetZ;
    }
  }
  const normal = geometry?.normal;
  const normals = normal?.array;
  if (ArrayBuffer.isView(normals) && Number.isInteger(normal.itemSize) && normal.itemSize >= 3) {
    for (let i = 0; i < normals.length; i += normal.itemSize) {
      const nx = normals[i] / scaleX;
      const ny = normals[i + 1];
      const nz = normals[i + 2];
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[i] = nx / length;
      normals[i + 1] = ny / length;
      normals[i + 2] = nz / length;
    }
  }
}

function rebaseMetadata(value, parentKey, scaleX, offsetX, offsetZ) {
  if (Array.isArray(value)) {
    if (value.length && value.every((point) => Array.isArray(point) && point.length >= 2 &&
        Number.isFinite(point[0]) && Number.isFinite(point[1]))) {
      return value.map(([x, z, ...rest]) => [x * scaleX + offsetX, z + offsetZ, ...rest]);
    }
    return value.map((item) => rebaseMetadata(item, parentKey, scaleX, offsetX, offsetZ));
  }
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) {
      if (key === "x" || key === "nx") value[key] = item * scaleX + offsetX;
      else if (key === "z" || key === "nz" || (key === "y" && parentKey === "pts")) value[key] = item + offsetZ;
    } else {
      value[key] = rebaseMetadata(item, key, scaleX, offsetX, offsetZ);
    }
  }
  return value;
}

/** Convert local-frame geometry and metadata to the active street engine's origin. */
export function rebasePrebuiltCityResult(result, bakedOrigin, runtimeOrigin) {
  if (!result || !Number.isFinite(bakedOrigin?.lat) || !Number.isFinite(bakedOrigin?.lon) ||
      !Number.isFinite(runtimeOrigin?.lat) || !Number.isFinite(runtimeOrigin?.lon)) {
    throw new TypeError("Prebuilt cell origin is invalid");
  }
  const runtimeFrame = makeLocalFrame(runtimeOrigin.lat, runtimeOrigin.lon);
  const bakedFrame = makeLocalFrame(bakedOrigin.lat, bakedOrigin.lon);
  const offset = runtimeFrame.toLocal(bakedOrigin.lat, bakedOrigin.lon);
  const scaleX = runtimeFrame.cosLat / bakedFrame.cosLat;

  const visitGeometry = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visitGeometry);
      return;
    }
    if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return;
    if (value.position?.array) transformGeometry(value, scaleX, offset.x, offset.z);
    if (value.geo?.position?.array) visitGeometry(value.geo);
    if (value.matrices instanceof Float32Array) {
      for (let i = 0; i + 15 < value.matrices.length; i += 16) {
        const m = value.matrices;
        m[i] *= scaleX;
        m[i + 4] *= scaleX;
        m[i + 8] *= scaleX;
        m[i + 12] = m[i + 12] * scaleX + offset.x;
        m[i + 14] += offset.z;
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === "geo" || key === "matrices") continue;
      visitGeometry(item);
    }
  };

  for (const [key, value] of Object.entries(result)) {
    if (key === "meta") result.meta = rebaseMetadata(value, key, scaleX, offset.x, offset.z);
    else visitGeometry(value);
  }
  return result;
}
