// One bounded request budget across mirrors; never outlive the Vercel route.
import { looksPartial, parseCityKey, validCityData, validCoordinates, isCompleteCity } from "./city-contract.js";
import { URBAN_LANDUSE_PATTERN } from "./engine/ground-surfaces.js";
export { looksPartial, parseCityKey };
const PUBLIC_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
// Prefer an optional self-hosted/Worker endpoint, but retain public mirrors as
// fallbacks so a missing or unhealthy deployment endpoint does not strand users.
const preferredEndpoint = process.env.OVERPASS_ENDPOINT?.trim();
const MIRRORS = [...new Set([preferredEndpoint, ...PUBLIC_MIRRORS].filter(Boolean))];
const UA = "WalkTheWorld/0.4 (https://github.com/dattaprasad-r-ekavade/walk-the-world)";
function combinedQuery(around) {
  return [
    `[out:json][timeout:25];`,
    `(way(${around})[building];way(${around})[building:part];); out geom 2000;`,
    `way(${around})[highway]; out geom 800;`,
    `(way(${around})[leisure~"^(park|pitch|swimming_pool|playground|track|golf_course)$"];way(${around})[landuse~"grass|forest|meadow|farmland|orchard|vineyard"];way(${around})[landuse~"${URBAN_LANDUSE_PATTERN}"];way(${around})[natural~"^(beach|sand)$"];way(${around})[amenity=parking];); out geom 900;`,
    `relation(${around})[type=multipolygon][landuse~"${URBAN_LANDUSE_PATTERN}"]; out geom 120;`,
    `(way(${around})[natural=water];way(${around})[natural=coastline];way(${around})[waterway=riverbank];way(${around})[waterway~"^(river|stream|canal)$"];); out geom 400;`,
    `(relation(${around})[natural=water];relation(${around})[waterway=riverbank];relation(${around})[water];); out geom 120;`,
    `way(${around})[railway~"^(rail|light_rail|tram)$"][!tunnel]; out geom 200;`,
    `(way(${around})[barrier~"^(wall|fence|hedge|city_wall)$"];way(${around})[natural=tree_row];way(${around})[power=line];); out geom 200;`,
    `(node(${around})[natural=tree];node(${around})[railway~"^(station|subway_entrance)$"];node(${around})[highway~"^(street_lamp|bus_stop|traffic_signals)$"];node(${around})[amenity~"^(bench|fountain|waste_basket|telephone)$"];node(${around})[advertising=billboard];node(${around})[man_made~"^(flagpole|tower|chimney|water_tower|windmill|lighthouse|silo|storage_tank|crane|obelisk)$"];node(${around})[barrier~"^(bollard|gate)$"];node(${around})[natural=peak];node(${around})[historic~"^(monument|memorial)$"];node(${around})["generator:source"="wind"];node(${around})[power=tower];node(${around})[shop];node(${around})[amenity];); out 700;`,
  ].join("");
}


async function queryMirror(url, body, signal) {
  const response = await fetch(url, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(28000)]),
  });
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  const data = await response.json();
  if (!validCityData(data) || !data.elements.length) throw new Error("Invalid or empty Overpass response");
  return data;
}

// Mirrors race with at most two in flight: the next one starts after staggerMs, or as soon as
// one fails. The first complete answer wins and aborts the rest; partials are kept as fallback.
// When every mirror fails fast (public Overpass is often "at capacity"), sweep the mirrors
// again after a backoff instead of giving up while most of the budget is left.
export async function fetchOverpassCell(lat, lon, { signal, timeoutMs = 85000, staggerMs = 1800, rounds = 3, backoffMs = 4000 } = {}) {
  if (!validCoordinates(lat, lon)) throw new RangeError("Invalid coordinates");
  const deadline = AbortSignal.timeout(timeoutMs);
  const budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
  budget.throwIfAborted();
  const body = "data=" + encodeURIComponent(combinedQuery(`around:${650},${lat},${lon}`));
  const losers = new AbortController();
  const attempts = AbortSignal.any([budget, losers.signal]);
  return new Promise((resolve, reject) => {
    let next = 0, inflight = 0, partial = null, lastError, done = false, timer, round = 1;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      budget.removeEventListener("abort", onBudget);
      losers.abort();
      if (error) reject(error); else resolve(value);
    };
    const exhausted = () => {
      if (signal?.aborted) return finish(signal.reason);
      if (partial) return finish(null, partial);
      finish(lastError || new Error("City data unavailable within request budget"));
    };
    const onBudget = () => exhausted();
    const launch = () => {
      clearTimeout(timer);
      if (done || next >= MIRRORS.length) return;
      const url = MIRRORS[next++];
      inflight++;
      queryMirror(url, body, attempts).then(data => {
        if (isCompleteCity(data)) return finish(null, data);
        partial = partial && partial.elements.length >= data.elements.length ? partial : { ...data, partial: true };
      }, error => { lastError = error; }).finally(() => {
        inflight--;
        if (done) return;
        if (inflight < 2 && next < MIRRORS.length) launch();
        else if (!inflight && !partial && round < rounds) {
          next = 0;
          timer = setTimeout(launch, backoffMs * round++);
        } else if (!inflight) exhausted();
      });
      if (next < MIRRORS.length) timer = setTimeout(() => { if (inflight < 2) launch(); }, staggerMs);
    };
    budget.addEventListener("abort", onBudget, { once: true });
    launch();
  });
}
