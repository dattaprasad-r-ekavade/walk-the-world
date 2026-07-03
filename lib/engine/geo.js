// Slippy-map tile math + local ENU helpers.
// slippy tile math
export const lon2tx = (lon, z) => ((lon + 180) / 360) * (1 << z);
export const lat2ty = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << z);
};
export const tx2lon = (x, z) => (x / (1 << z)) * 360 - 180;
export const ty2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// Factories for a local East-North-Up frame centred on (lat0, lon0), meters.
export const EARTH_R = 6378137;
export function makeLocalFrame(lat0, lon0) {
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  return {
    cosLat,
    toLocal: (lat, lon) => ({
      x: ((lon - lon0) * Math.PI * EARTH_R * cosLat) / 180,
      z: -(((lat - lat0) * Math.PI * EARTH_R) / 180),
    }),
    toGeo: (x, z) => ({
      lat: lat0 - (z * 180) / (Math.PI * EARTH_R),
      lon: lon0 + (x * 180) / (Math.PI * EARTH_R * cosLat),
    }),
  };
}
