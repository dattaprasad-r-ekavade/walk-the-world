/**
 * Live walk trail buffer (10.5) — mutated without React re-renders.
 * Minimap reads via trailRef; passport store is flushed periodically.
 */

const TRAIL_MAX = 400;
const TRAIL_MIN_M = 8;

export function createTrailBuffer(seed = []) {
  const points = Array.isArray(seed) ? seed.slice(-TRAIL_MAX) : [];
  let dirty = false;

  const push = (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const last = points[points.length - 1];
    if (last) {
      const dLat = (lat - last.lat) * 111320;
      const dLon = (lon - last.lon) * 111320 * Math.cos((lat * Math.PI) / 180);
      if (Math.hypot(dLat, dLon) < TRAIL_MIN_M) return false;
    }
    points.push({ lat, lon });
    while (points.length > TRAIL_MAX) points.shift();
    dirty = true;
    return true;
  };

  return {
    points,
    push,
    get dirty() {
      return dirty;
    },
    takeDirty() {
      if (!dirty) return null;
      dirty = false;
      return points.slice();
    },
    snapshot() {
      return points.slice();
    },
  };
}
