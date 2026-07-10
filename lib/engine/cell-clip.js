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

export function isCorridorElement(el) {
  const tags = el?.tags || {};
  return !!(
    tags.highway ||
    tags.railway ||
    tags.bridge ||
    tags.waterway === "riverbank" ||
    tags.natural === "water"
  );
}

/**
 * Ownership clip for streamed / spawn tiles.
 * Corridors (roads/rail/bridges) are kept whole — OSM-id dedupe prevents
 * doubles; clipping them was causing gaps at cell seams.
 * Buildings/props use centroid ownership so walls don't stack.
 */
export function clipElementsToCell(elements, cellLat, cellLon, halfStep = CELL_STEP / 2) {
  if (!Array.isArray(elements)) return [];
  return elements.filter((el) => {
    if (isCorridorElement(el)) return true;
    const c = elementLatLon(el);
    if (!c) return false;
    return (
      Math.abs(c.lat - cellLat) <= halfStep + 1e-9 &&
      Math.abs(c.lon - cellLon) <= halfStep + 1e-9
    );
  });
}

/** Drop OSM ids already assembled; mark the rest as seen. Returns kept + their ids. */
export function takeUnseenElements(elements, seenIds) {
  if (!Array.isArray(elements)) return { elements: [], ids: [] };
  const out = [];
  const ids = [];
  for (const el of elements) {
    if (el?.id == null || !el.type) continue;
    const id = `${el.type}/${el.id}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(el);
    ids.push(id);
  }
  return { elements: out, ids };
}

export function noteElementIds(elements, seenIds) {
  if (!Array.isArray(elements) || !seenIds) return [];
  const ids = [];
  for (const el of elements) {
    if (el?.id == null || !el.type) continue;
    const id = `${el.type}/${el.id}`;
    seenIds.add(id);
    ids.push(id);
  }
  return ids;
}

export function forgetElementIds(ids, seenIds) {
  if (!ids || !seenIds) return;
  for (const id of ids) seenIds.delete(id);
}
