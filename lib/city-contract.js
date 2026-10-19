// Shared by the browser, API, and seed scripts. Existing cache addresses stay valid.
export const CACHE_VERSION = 6;
export const CELL_STEP = 0.0055;
export const MAX_CITY_BYTES = 8_000_000;

export function validCoordinates(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

export function cityCacheKey(lat, lon) {
  if (!validCoordinates(lat, lon)) throw new RangeError('Invalid city coordinates');
  return `wtw_city${CACHE_VERSION}_${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

export function parseCityKey(key) {
  const m = /^wtw_city\d+_(-?\d+\.\d{3})_(-?\d+\.\d{3})$/.exec(key);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return validCoordinates(lat, lon) ? { lat, lon } : null;
}

export function looksPartial(elements) {
  let buildings = 0, highways = 0;
  for (const e of elements || []) {
    if (e.tags?.building) buildings++;
    else if (e.type === 'way' && e.tags?.highway) highways++;
  }
  return { partial: buildings === 0 && highways >= 20, buildings, highways };
}

export function validCityData(data) {
  return !!data && Array.isArray(data.elements) && data.elements.length <= 100000 &&
    data.elements.every(e => e && ['node', 'way', 'relation'].includes(e.type) &&
      Number.isSafeInteger(e.id) &&
      (e.tags == null || (typeof e.tags === 'object' && !Array.isArray(e.tags))) &&
      (e.geometry == null || (Array.isArray(e.geometry) && e.geometry.every(p => p && validCoordinates(p.lat, p.lon)))) &&
      (e.type !== 'node' || validCoordinates(e.lat, e.lon)));
}

export function isCompleteCity(data) {
  return validCityData(data) && !data.partial && !data.remark && !looksPartial(data.elements).partial;
}

/** A stable arrival-anchored lattice; motion within a tile never shifts its neighbors. */
export function cellNeighborhood(lat, lon, originLat = lat, originLon = lon) {
  const i = Math.round((lat - originLat) / CELL_STEP);
  const j = Math.round((lon - originLon) / CELL_STEP);
  return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    .map(([di, dj]) => [Number((originLat + (i + di) * CELL_STEP).toFixed(7)), Number((originLon + (j + dj) * CELL_STEP).toFixed(7))])
    .filter(([la, lo]) => validCoordinates(la, lo));
}
