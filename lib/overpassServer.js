// Server-side Overpass fetch for a city cell (~650 m radius).
// Per-category caps so dense cells can't starve roads/props/landuse
// when one category fills a shared union first (plan 7.3).

const UA =
  "WalkTheWorld/0.4 (https://github.com/dattaprasad-r-ekavade/walk-the-world)";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Stick to the last mirror that answered — hopping every miss burns minutes on
// rate-limit HTML / dead mirrors and is what made seed time out on Vercel.
let preferredMirror = MIRRORS[0];
let rateLimitedUntil = 0;

function mirrorOrder() {
  return [preferredMirror, ...MIRRORS.filter((u) => u !== preferredMirror)];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildingsQuery(around) {
  return `[out:json][timeout:60];way(${around})[building];out geom 2000;`;
}

function roadsQuery(around) {
  return `[out:json][timeout:60];way(${around})[highway];out geom 800;`;
}

function landuseQuery(around) {
  return `[out:json][timeout:60];(way(${around})[leisure~"^(park|pitch|swimming_pool|playground|track|golf_course)$"];way(${around})[landuse~"grass|forest|meadow|farmland|orchard|vineyard"];way(${around})[natural~"^(beach|sand)$"];way(${around})[amenity=parking];);out geom 600;`;
}

function waterQuery(around) {
  return `[out:json][timeout:60];(way(${around})[natural=water];way(${around})[waterway=riverbank];way(${around})[waterway~"^(river|stream|canal)$"];);out geom 400;(relation(${around})[natural=water];relation(${around})[waterway=riverbank];relation(${around})[water];);out geom 120;`;
}

function railQuery(around) {
  return `[out:json][timeout:60];way(${around})[railway~"^(rail|light_rail|tram)$"][!tunnel];out geom 200;`;
}

function barrierQuery(around) {
  return `[out:json][timeout:60];(way(${around})[barrier~"^(wall|fence|hedge|city_wall)$"];way(${around})[natural=tree_row];way(${around})[power=line];);out geom 200;`;
}

function propsQuery(around) {
  return `[out:json][timeout:60];(node(${around})[natural=tree];node(${around})[railway~"^(station|subway_entrance)$"];node(${around})[highway~"^(street_lamp|bus_stop|traffic_signals)$"];node(${around})[amenity~"^(bench|fountain|waste_basket|telephone)$"];node(${around})[advertising=billboard];node(${around})[man_made~"^(flagpole|tower|chimney|water_tower|windmill|lighthouse|silo|storage_tank|crane|obelisk)$"];node(${around})[barrier~"^(bollard|gate)$"];node(${around})[natural=peak];node(${around})[historic~"^(monument|memorial)$"];node(${around})["generator:source"="wind"];node(${around})[power=tower];node(${around})[shop];node(${around})[amenity];);out 700;`;
}

/** One HTTP round-trip with per-category out caps (best for seeding / rate limits). */
function combinedQuery(around) {
  return [
    `[out:json][timeout:90];`,
    `way(${around})[building]; out geom 2000;`,
    `way(${around})[highway]; out geom 800;`,
    `(way(${around})[leisure~"^(park|pitch|swimming_pool|playground|track|golf_course)$"];way(${around})[landuse~"grass|forest|meadow|farmland|orchard|vineyard"];way(${around})[natural~"^(beach|sand)$"];way(${around})[amenity=parking];); out geom 600;`,
    `(way(${around})[natural=water];way(${around})[waterway=riverbank];way(${around})[waterway~"^(river|stream|canal)$"];); out geom 400;`,
    `(relation(${around})[natural=water];relation(${around})[waterway=riverbank];relation(${around})[water];); out geom 120;`,
    `way(${around})[railway~"^(rail|light_rail|tram)$"][!tunnel]; out geom 200;`,
    `(way(${around})[barrier~"^(wall|fence|hedge|city_wall)$"];way(${around})[natural=tree_row];way(${around})[power=line];); out geom 200;`,
    `(node(${around})[natural=tree];node(${around})[railway~"^(station|subway_entrance)$"];node(${around})[highway~"^(street_lamp|bus_stop|traffic_signals)$"];node(${around})[amenity~"^(bench|fountain|waste_basket|telephone)$"];node(${around})[advertising=billboard];node(${around})[man_made~"^(flagpole|tower|chimney|water_tower|windmill|lighthouse|silo|storage_tank|crane|obelisk)$"];node(${around})[barrier~"^(bollard|gate)$"];node(${around})[natural=peak];node(${around})[historic~"^(monument|memorial)$"];node(${around})["generator:source"="wind"];node(${around})[power=tower];node(${around})[shop];node(${around})[amenity];); out 700;`,
  ].join("");
}

async function runQuery(q, { timeoutMs = 90_000 } = {}) {
  let lastErr;
  const wait = Math.max(0, rateLimitedUntil - Date.now());
  if (wait) {
    console.warn(`[overpass] rate-limit cooldown ${Math.ceil(wait / 1000)}s`);
    await sleep(wait);
  }

  for (const url of mirrorOrder()) {
    try {
      const r = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": UA,
        },
        // Avoid Next.js Data Cache trying (and failing) to store multi-MB Overpass payloads.
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await r.text();
      if (!text.startsWith("{")) {
        // Public mirrors return HTML when the slot is exhausted.
        rateLimitedUntil = Date.now() + 60_000;
        throw new Error("rate-limited");
      }
      const data = JSON.parse(text);
      if (data.remark && !data.elements?.length) throw new Error(data.remark);
      preferredMirror = url;
      return data;
    } catch (e) {
      lastErr = e;
      console.warn(`[overpass] ${url} failed: ${String(e).slice(0, 80)}`);
    }
  }
  throw lastErr || new Error("overpass failed");
}

function mergeElements(...datasets) {
  const byId = new Map();
  for (const data of datasets) {
    for (const el of data.elements || []) {
      byId.set(`${el.type}/${el.id}`, el);
    }
  }
  return { elements: [...byId.values()] };
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = { status: "fulfilled", value: await fn(items[idx], idx) };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function fetchOverpassCell(lat, lon) {
  const around = `around:650,${lat},${lon}`;
  const q = combinedQuery(around);

  // Retry the single combined query with backoff. Do NOT fan out into 7
  // category requests on rate-limit — that makes the ban worse.
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const data = await runQuery(q, { timeoutMs: 100_000 });
      const bCount = (data.elements || []).filter((e) => e.tags?.building).length;
      console.log(
        `[overpass] ${lat.toFixed(3)},${lon.toFixed(3)} → ${data.elements?.length ?? 0} elements (${bCount} buildings, combined)`
      );
      if ((data.elements?.length ?? 0) > 0) return data;
      lastErr = new Error("empty overpass result");
    } catch (e) {
      lastErr = e;
      console.warn(`[overpass] attempt ${attempt + 1}/4 failed: ${String(e).slice(0, 80)}`);
      await sleep(15_000 * (attempt + 1));
    }
  }

  // Last resort: buildings + roads only (2 queries, sequential).
  try {
    const settled = await mapPool(
      [buildingsQuery(around), roadsQuery(around)],
      1,
      (qq) => runQuery(qq, { timeoutMs: 60_000 })
    );
    const ok = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
    if (!ok.length) throw settled[0].reason || lastErr || new Error("overpass failed");
    const merged = mergeElements(...ok);
    const bCount = merged.elements.filter((e) => e.tags?.building).length;
    console.log(
      `[overpass] ${lat.toFixed(3)},${lon.toFixed(3)} → ${merged.elements.length} elements (${bCount} buildings, buildings+roads fallback)`
    );
    return merged;
  } catch (e) {
    throw lastErr || e;
  }
}

export function parseCityKey(key) {
  const m = key.match(/^wtw_city\d+_(-?\d+\.\d{3})_(-?\d+\.\d{3})$/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
}
