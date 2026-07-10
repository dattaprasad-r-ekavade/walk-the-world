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
 * Keep features for a streamed cell.
 * Buildings/props: strict centroid ownership (no stacking).
 * Highways/rail/bridges: looser bbox + any-vertex test so ribbons meet
 * across cell edges instead of leaving gaps; OSM-id dedupe still prevents doubles.
 */
export function clipElementsToCell(elements, cellLat, cellLon, halfStep = CELL_STEP / 2) {
  if (!Array.isArray(elements)) return [];
  const roadHalf = halfStep * 1.4;
  return elements.filter((el) => {
    const tags = el.tags || {};
    const isCorridor =
      !!tags.highway ||
      !!tags.railway ||
      !!tags.bridge ||
      tags.waterway === "riverbank" ||
      tags.natural === "water";
    const h = isCorridor ? roadHalf : halfStep;
    const c = elementLatLon(el);
    if (c && Math.abs(c.lat - cellLat) <= h + 1e-9 && Math.abs(c.lon - cellLon) <= h + 1e-9) {
      return true;
    }
    if (isCorridor && Array.isArray(el.geometry)) {
      for (const p of el.geometry) {
        if (
          Number.isFinite(p?.lat) &&
          Number.isFinite(p?.lon) &&
          Math.abs(p.lat - cellLat) <= h + 1e-9 &&
          Math.abs(p.lon - cellLon) <= h + 1e-9
        ) {
          return true;
        }
      }
    }
    return false;
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
