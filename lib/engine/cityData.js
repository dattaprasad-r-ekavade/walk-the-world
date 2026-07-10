// City-cell data with three-tier caching:
//   1. localStorage (7-day TTL, same machine)
//   2. /api/city/<key> — R2 cache, or server-side Overpass on miss
//   3. (legacy) client no longer calls Overpass directly — dense cities
//      were losing buildings to the old 1700-way combined cap.

const CACHE_VERSION = 6; // 7.3 per-category Overpass caps

export function cityCacheKey(lat0, lon0) {
  return `wtw_city${CACHE_VERSION}_${lat0.toFixed(3)}_${lon0.toFixed(3)}`;
}

async function fromLocalStorage(cacheKey) {
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (hit && Date.now() - hit.t < 7 * 864e5) return hit.d;
  } catch {
    /* ignore */
  }
  return null;
}

async function fromPublicR2(cacheKey) {
  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE;
  if (!publicBase) return null;
  const res = await fetch(`${publicBase}/${cacheKey}.json`).catch(() => null);
  if (res?.ok) return res.json();
  return null;
}

async function fromApi(cacheKey) {
  const res = await fetch(`/api/city/${cacheKey}`).catch(() => null);
  if (res?.ok) return res.json();
  return null;
}

export async function fetchCityData(lat0, lon0) {
  if (typeof window !== "undefined" && window.__BENCH_MODE && window.__BENCH_FIXTURE) {
    return window.__BENCH_FIXTURE;
  }

  const cacheKey = cityCacheKey(lat0, lon0);
  let data = await fromLocalStorage(cacheKey);
  let fromBucket = false;

  if (!data) {
    data = await fromPublicR2(cacheKey);
    if (data) fromBucket = true;
  }

  if (!data) {
    data = await fromApi(cacheKey);
    if (data) fromBucket = true;
  }

  if (!data) {
    throw new Error("city data unavailable — check /api/city and Overpass");
  }

  if (!fromBucket) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d: data }));
    } catch {
      /* quota */
    }
  }

  return data;
}

/**
 * Prefer a nearby already-warm R2/localStorage cell (seed keys sit on
 * ±0.0055° rings, not every 0.001° the player steps on). Falls back to a
 * cold fetch at the exact snapped coordinate.
 * @returns {Promise<{ data: object, cacheKey: string, lat: number, lon: number }>}
 */
export async function fetchCityDataNear(lat, lon) {
  if (typeof window !== "undefined" && window.__BENCH_MODE && window.__BENCH_FIXTURE) {
    return {
      data: window.__BENCH_FIXTURE,
      cacheKey: cityCacheKey(lat, lon),
      lat: Number(lat.toFixed(3)),
      lon: Number(lon.toFixed(3)),
    };
  }

  const offsets = [[0, 0]];
  for (let r = 1; r <= 7; r++) {
    for (let dla = -r; dla <= r; dla++) {
      for (let dlo = -r; dlo <= r; dlo++) {
        if (Math.max(Math.abs(dla), Math.abs(dlo)) !== r) continue;
        offsets.push([dla * 0.001, dlo * 0.001]);
      }
    }
  }

  const tried = new Set();
  for (const [dla, dlo] of offsets) {
    const la = Number((lat + dla).toFixed(3));
    const lo = Number((lon + dlo).toFixed(3));
    const key = cityCacheKey(la, lo);
    if (tried.has(key)) continue;
    tried.add(key);

    let data = await fromLocalStorage(key);
    if (data?.elements?.length) return { data, cacheKey: key, lat: la, lon: lo };
    data = await fromPublicR2(key);
    if (data?.elements?.length) return { data, cacheKey: key, lat: la, lon: lo };
  }

  const la = Number(lat.toFixed(3));
  const lo = Number(lon.toFixed(3));
  const data = await fetchCityData(la, lo);
  return { data, cacheKey: cityCacheKey(la, lo), lat: la, lon: lo };
}
