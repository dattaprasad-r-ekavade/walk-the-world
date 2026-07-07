// City-cell data with three-tier caching:
//   1. localStorage (7-day TTL, same machine)
//   2. /api/city/<key> — R2 cache, or server-side Overpass on miss
//   3. (legacy) client no longer calls Overpass directly — dense cities
//      were losing buildings to the old 1700-way combined cap.

const CACHE_VERSION = 5;

export function cityCacheKey(lat0, lon0) {
  return `wtw_city${CACHE_VERSION}_${lat0.toFixed(3)}_${lon0.toFixed(3)}`;
}

export async function fetchCityData(lat0, lon0) {
  if (typeof window !== 'undefined' && window.__BENCH_MODE && window.__BENCH_FIXTURE) {
    return window.__BENCH_FIXTURE;
  }

  const cacheKey = cityCacheKey(lat0, lon0);
  let data = null;
  let fromBucket = false;

  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (hit && Date.now() - hit.t < 7 * 864e5) data = hit.d;
  } catch {
    /* ignore */
  }

  // Prefer the public R2 custom domain when configured: served straight
  // from Cloudflare's edge cache (zero egress, no server hop). Objects are
  // stored gzipped with Content-Encoding, so fetch() decompresses natively.
  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE;
  if (!data && publicBase) {
    const res = await fetch(`${publicBase}/${cacheKey}.json`).catch(() => null);
    if (res?.ok) {
      data = await res.json();
      fromBucket = true;
    }
  }

  if (!data) {
    const res = await fetch(`/api/city/${cacheKey}`).catch(() => null);
    if (res?.ok) {
      data = await res.json();
      fromBucket = true;
    }
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
