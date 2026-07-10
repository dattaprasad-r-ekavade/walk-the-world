/** Same neighbor offset the seed script / prefetch use (~611 m). */
export const CELL_STEP = 0.0055;

/** Representative lat/lon for an OSM element (node or way centroid). */
export function elementLatLon(el) {
  if (!el) return null;
  if (el.type === "node" && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
    return { lat: el.lat, lon: el.lon };
  }
  const pts = el.geometry;
  if (!Array.isArray(pts) || !pts.length) return null;
  let la = 0;
  let lo = 0;
  let n = 0;
  for (const p of pts) {
    if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
    la += p.lat;
    lo += p.lon;
    n++;
  }
  if (!n) return null;
  return { lat: la / n, lon: lo / n };
}

/**
 * Keep features whose centroid sits in this cell's tile
 * (± half of CELL_STEP). Stops overlapping 650 m Overpass disks from
 * stacking duplicate roads/buildings/benches on top of each other.
 */
export function clipElementsToCell(elements, cellLat, cellLon, halfStep = CELL_STEP / 2) {
  if (!Array.isArray(elements)) return [];
  return elements.filter((el) => {
    const c = elementLatLon(el);
    if (!c) return false;
    return (
      Math.abs(c.lat - cellLat) <= halfStep + 1e-9 &&
      Math.abs(c.lon - cellLon) <= halfStep + 1e-9
    );
  });
}

/** Drop OSM ids already assembled; mark the rest as seen. */
export function takeUnseenElements(elements, seenIds) {
  if (!Array.isArray(elements)) return [];
  const out = [];
  for (const el of elements) {
    if (el?.id == null || !el.type) continue;
    const id = `${el.type}/${el.id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(el);
  }
  return out;
}

export function noteElementIds(elements, seenIds) {
  if (!Array.isArray(elements) || !seenIds) return;
  for (const el of elements) {
    if (el?.id == null || !el.type) continue;
    seenIds.add(`${el.type}/${el.id}`);
  }
}
