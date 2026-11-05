// Painted roads for walking inside Cesium: OSM highways around the walker,
// drawn as ground-clamped corridors coloured and sized by road class.

export const GLOBE_ROAD_STYLE = {
  motorway: ["#4a5568", 18], trunk: ["#4a5568", 16],
  primary: ["#5a6474", 14], secondary: ["#616b7a", 11],
  tertiary: ["#6a7382", 9], residential: ["#788190", 7],
  unclassified: ["#788190", 6], service: ["#8a92a0", 4],
  pedestrian: ["#9a8f7a", 5], footway: ["#a89878", 2.5],
  path: ["#a89878", 2], cycleway: ["#7a8fa8", 2.5],
  living_street: ["#8a92a0", 6], track: ["#9a8a6a", 3],
};

const RELOAD_DEGREES = 0.0025; // ~250 m: still inside the loaded area

/** Overpass ways to [{ positions: [lon, lat, ...], color, width }]. */
export function roadCorridors(elements) {
  const out = [];
  for (const way of elements || []) {
    if (!way.geometry || way.geometry.length < 2) continue;
    const style = GLOBE_ROAD_STYLE[way.tags?.highway];
    if (!style) continue;
    const positions = [];
    for (const g of way.geometry) positions.push(g.lon, g.lat);
    out.push({ positions, color: style[0], width: style[1] });
  }
  return out;
}

export function createRoadOverlay(Cesium, viewer, { isDestroyed }) {
  let entities = [];
  let loaded = { lat: null, lon: null, busy: false };

  /** Reloads roads within 450 m once the walker leaves the loaded area. */
  const loadAround = async (latRad, lonRad) => {
    const lat = Cesium.Math.toDegrees(latRad);
    const lon = Cesium.Math.toDegrees(lonRad);
    if (loaded.busy) return;
    if (loaded.lat !== null && Math.hypot(lat - loaded.lat, lon - loaded.lon) < RELOAD_DEGREES) return;
    loaded = { lat, lon, busy: true };
    try {
      const query = `[out:json][timeout:15];way(around:450,${lat.toFixed(5)},${lon.toFixed(5)})[highway];out geom 400;`;
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      const data = await res.json();
      if (isDestroyed()) return;
      for (const e of entities) viewer.entities.remove(e);
      entities = roadCorridors(data.elements).map(({ positions, color, width }) => viewer.entities.add({
        corridor: {
          positions: Cesium.Cartesian3.fromDegreesArray(positions),
          width,
          material: Cesium.Color.fromCssColorString(color).withAlpha(0.85),
          classificationType: Cesium.ClassificationType.TERRAIN,
        },
      }));
    } catch (e) {
      console.warn("[roads] overpass fetch failed:", e?.message);
    } finally {
      loaded.busy = false;
    }
  };

  return { loadAround };
}
