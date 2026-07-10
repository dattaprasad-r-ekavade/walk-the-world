// City-cell data with three-tier caching + client Overpass fallback:
//   1. localStorage (7-day TTL)
//   2. public R2 CDN
//   3. /api/city (R2 miss → Vercel Overpass — often times out)
//   4. browser → Overpass mirrors (works for live GPS / walk streaming)

const CACHE_VERSION = 6; // 7.3 per-category Overpass caps

const CLIENT_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const UA =
  "WalkTheWorld/0.4 (https://github.com/dattaprasad-r-ekavade/walk-the-world)";

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

function rememberLocal(cacheKey, data) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d: data }));
  } catch {
    /* quota */
  }
}

async function fromPublicR2(cacheKey) {
  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE;
  if (!publicBase) return null;
  const res = await fetch(`${publicBase}/${cacheKey}.json`).catch(() => null);
  if (res?.ok) return res.json();
  return null;
}

async function fromApi(cacheKey) {
  // Short timeout — Vercel cold Overpass rarely finishes; fall through to client.
  const res = await fetch(`/api/city/${cacheKey}`, {
    signal: AbortSignal.timeout(25_000),
  }).catch(() => null);
  if (res?.ok) return res.json();
  return null;
}

function clientOverpassQuery(lat, lon) {
  const around = `around:650,${lat},${lon}`;
  return [
    `[out:json][timeout:75];`,
    `way(${around})[building]; out geom 1500;`,
    `way(${around})[highway]; out geom 600;`,
    `(way(${around})[leisure~"^(park|pitch|playground)$"];way(${around})[landuse~"grass|forest|meadow"];way(${around})[amenity=parking];); out geom 400;`,
    `(way(${around})[natural=water];way(${around})[waterway~"^(river|stream|canal|riverbank)$"];); out geom 300;`,
    `way(${around})[railway~"^(rail|light_rail|tram)$"][!tunnel]; out geom 150;`,
    `(node(${around})[natural=tree];node(${around})[highway~"^(street_lamp|bus_stop|traffic_signals)$"];node(${around})[amenity~"^(fountain|waste_basket)$"];node(${around})[shop];node(${around})[amenity];); out 500;`,
  ].join("");
}

async function fromClientOverpass(lat, lon) {
  if (typeof window === "undefined") return null;
  const q = clientOverpassQuery(lat, lon);
  for (const url of CLIENT_MIRRORS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
        },
        signal: AbortSignal.timeout(90_000),
      });
      const text = await r.text();
      if (!text.startsWith("{")) continue;
      const data = JSON.parse(text);
      if (!data.elements?.length) continue;
      console.info(
        `[overpass:client] ${lat.toFixed(3)},${lon.toFixed(3)} → ${data.elements.length} elements via ${url}`
      );
      return data;
    } catch (e) {
      console.warn(`[overpass:client] ${url}:`, e?.message || e);
    }
  }
  return null;
}

export async function fetchCityData(lat0, lon0) {
  if (typeof window !== "undefined" && window.__BENCH_MODE && window.__BENCH_FIXTURE) {
    return window.__BENCH_FIXTURE;
  }

  const cacheKey = cityCacheKey(lat0, lon0);
  let data = await fromLocalStorage(cacheKey);

  if (!data) data = await fromPublicR2(cacheKey);
  if (!data) data = await fromApi(cacheKey);
  if (!data) data = await fromClientOverpass(lat0, lon0);

  if (!data) {
    throw new Error("city data unavailable — check /api/city and Overpass");
  }

  rememberLocal(cacheKey, data);
  return data;
}

/**
 * Prefer a nearby already-warm R2/localStorage cell (seed keys sit on
 * ±0.0055° rings). Falls back to exact-cell fetch (API → client Overpass).
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
