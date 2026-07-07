// Server-side Overpass fetch for a city cell (~650 m radius).
// Buildings are queried separately so dense cities (NYC, Tokyo) don't lose
// footprints to the shared way cap when roads fill the union first.

const UA =
  "WalkTheWorld/0.4 (https://github.com/dattaprasad-r-ekavade/walk-the-world)";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

function buildingsQuery(around) {
  return `[out:json][timeout:60];way(${around})[building];out geom 2000;`;
}

function infraQuery(around) {
  return `[out:json][timeout:60];(way(${around})[highway];way(${around})[railway~"^(rail|light_rail|tram)$"][!tunnel];way(${around})[natural=water];way(${around})[waterway=riverbank];way(${around})[waterway~"^(river|stream|canal)$"];way(${around})[leisure~"^(park|pitch|swimming_pool|playground|track|golf_course)$"];way(${around})[landuse~"grass|forest|meadow|farmland|orchard|vineyard"];way(${around})[natural~"^(beach|sand)$"];way(${around})[amenity=parking];way(${around})[barrier~"^(wall|fence|hedge|city_wall)$"];way(${around})[natural=tree_row];way(${around})[power=line];);out geom 1500;(relation(${around})[natural=water];relation(${around})[waterway=riverbank];relation(${around})[water];);out geom 120;(node(${around})[natural=tree];node(${around})[railway~"^(station|subway_entrance)$"];node(${around})[highway~"^(street_lamp|bus_stop|traffic_signals)$"];node(${around})[amenity~"^(bench|fountain|waste_basket|telephone)$"];node(${around})[advertising=billboard];node(${around})[man_made~"^(flagpole|tower|chimney|water_tower|windmill|lighthouse|silo|storage_tank|crane|obelisk)$"];node(${around})[barrier~"^(bollard|gate)$"];node(${around})[natural=peak];node(${around})[historic~"^(monument|memorial)$"];node(${around})["generator:source"="wind"];node(${around})[power=tower];);out 700;`;
}

async function runQuery(q) {
  let lastErr;
  // fail fast: one pass over all mirrors at 20 s (healthy mirrors answer in
  // 1-3 s), then a 60 s second pass — a dead mirror costs 20 s, not minutes
  for (const timeoutMs of [20_000, 60_000]) {
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
  const [buildings, infra] = await Promise.all([
    runQuery(buildingsQuery(around)),
    runQuery(infraQuery(around)),
  ]);
  const merged = mergeElements(buildings, infra);
  const bCount = merged.elements.filter((e) => e.tags?.building).length;
  console.log(
    `[overpass] ${lat.toFixed(3)},${lon.toFixed(3)} → ${merged.elements.length} elements (${bCount} buildings)`
  );
  return merged;
}

export function parseCityKey(key) {
  const m = key.match(/^wtw_city\d+_(-?\d+\.\d{3})_(-?\d+\.\d{3})$/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
}
