// Server-side Overpass fetch for a city cell (~650 m radius).
// Per-category caps so dense cells can't starve roads/props/landuse
// when one category fills a shared union first (plan 7.3).

const UA =
  "WalkTheWorld/0.4 (https://github.com/dattaprasad-r-ekavade/walk-the-world)";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

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

async function runQuery(q) {
  let lastErr;
  for (const timeoutMs of [15_000, 40_000]) {
    for (const url of MIRRORS) {
      try {
        const r = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(q),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": UA,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await r.text();
        if (!text.startsWith("{")) throw new Error(text.slice(0, 120));
        const data = JSON.parse(text);
        if (data.remark && !data.elements?.length) throw new Error(data.remark);
        return data;
      } catch (e) {
        lastErr = e;
        console.warn(`[overpass] ${url} failed (${timeoutMs}ms pass): ${String(e).slice(0, 80)}`);
      }
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

export async function fetchOverpassCell(lat, lon) {
  const around = `around:650,${lat},${lon}`;
  // Partial results beat none: each category is independent so a timeout
  // in props doesn't wipe buildings/roads.
  const settled = await Promise.allSettled([
    runQuery(buildingsQuery(around)),
    runQuery(roadsQuery(around)),
    runQuery(landuseQuery(around)),
    runQuery(waterQuery(around)),
    runQuery(railQuery(around)),
    runQuery(barrierQuery(around)),
    runQuery(propsQuery(around)),
  ]);
  const ok = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!ok.length) throw settled[0].reason || new Error("overpass failed");
  const merged = mergeElements(...ok);
  const bCount = merged.elements.filter((e) => e.tags?.building).length;
  console.log(
    `[overpass] ${lat.toFixed(3)},${lon.toFixed(3)} → ${merged.elements.length} elements (${bCount} buildings, ${ok.length}/7 queries)`
  );
  return merged;
}

export function parseCityKey(key) {
  const m = key.match(/^wtw_city\d+_(-?\d+\.\d{3})_(-?\d+\.\d{3})$/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
}
