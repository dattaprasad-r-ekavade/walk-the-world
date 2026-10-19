// One bounded request budget across mirrors; never outlive the Vercel route.
import { looksPartial, parseCityKey, validCityData, validCoordinates, isCompleteCity } from "./city-contract.js";
export { looksPartial, parseCityKey };
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "WalkTheWorld/0.4 (https://github.com/dattaprasad-r-ekavade/walk-the-world)";
function combinedQuery(around) {
  return [
    `[out:json][timeout:25];`,
    `way(${around})[building]; out geom 2000;`,
    `way(${around})[highway]; out geom 800;`,
    `(way(${around})[leisure~"^(park|pitch|swimming_pool|playground|track|golf_course)$"];way(${around})[landuse~"grass|forest|meadow|farmland|orchard|vineyard"];way(${around})[natural~"^(beach|sand)$"];way(${around})[amenity=parking];); out geom 600;`,
    `(way(${around})[natural=water];way(${around})[natural=coastline];way(${around})[waterway=riverbank];way(${around})[waterway~"^(river|stream|canal)$"];); out geom 400;`,
    `(relation(${around})[natural=water];relation(${around})[waterway=riverbank];relation(${around})[water];); out geom 120;`,
    `way(${around})[railway~"^(rail|light_rail|tram)$"][!tunnel]; out geom 200;`,
    `(way(${around})[barrier~"^(wall|fence|hedge|city_wall)$"];way(${around})[natural=tree_row];way(${around})[power=line];); out geom 200;`,
    `(node(${around})[natural=tree];node(${around})[railway~"^(station|subway_entrance)$"];node(${around})[highway~"^(street_lamp|bus_stop|traffic_signals)$"];node(${around})[amenity~"^(bench|fountain|waste_basket|telephone)$"];node(${around})[advertising=billboard];node(${around})[man_made~"^(flagpole|tower|chimney|water_tower|windmill|lighthouse|silo|storage_tank|crane|obelisk)$"];node(${around})[barrier~"^(bollard|gate)$"];node(${around})[natural=peak];node(${around})[historic~"^(monument|memorial)$"];node(${around})["generator:source"="wind"];node(${around})[power=tower];node(${around})[shop];node(${around})[amenity];); out 700;`,
  ].join("");
}


export async function fetchOverpassCell(lat, lon, { signal, timeoutMs = 85000 } = {}) {
  if (!validCoordinates(lat, lon)) throw new RangeError("Invalid coordinates");
  const deadline = AbortSignal.timeout(timeoutMs);
  const budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let partial = null, lastError;
  for (const url of MIRRORS) {
    budget.throwIfAborted();
    try {
      const response = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(combinedQuery(`around:650,${lat},${lon}`)),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        cache: "no-store",
        signal: AbortSignal.any([budget, AbortSignal.timeout(28000)]),
      });
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const data = await response.json();
      if (!validCityData(data) || !data.elements.length) throw new Error("Invalid or empty Overpass response");
      if (isCompleteCity(data)) return data;
      partial = { ...data, partial: true };
    } catch (error) {
      lastError = error;
      if (budget.aborted) break;
    }
  }
  if (signal?.aborted) signal.throwIfAborted();
  if (partial) return partial;
  throw lastError || new Error("City data unavailable within request budget");
}
