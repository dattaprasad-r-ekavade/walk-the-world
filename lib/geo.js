// Fast-travel spots — placed ON famous streets/plazas (not inside monuments)
// so landing always puts you on walkable open ground.
// The four cities shown in fast travel, Today's walk and Where-am-I while the
// app is in demo mode. Keep these warm in R2: `npm run seed:demo`.
// Each entry may carry a `preset` ({ hour, weather }) applied once on arrival so the
// showcase always opens at a pleasant golden-hour/dusk look instead of the real
// local time. weather: 0 = clear (engine weather slider 0..100).
export const DEMO_PLACES = [
  // Nudged ~170 m from Koregaon Park (18.540913,73.895553): residential lane with
  // buildings on both sides. Cell keys to re-seed: wtw_city6_18.540_73.897 (+ old 18.541_73.896).
  { name: "Pune", lat: 18.539897, lon: 73.896776, preset: { hour: 17, weather: 0 } },
  { name: "Edinburgh", lat: 55.9505, lon: -3.1875, preset: { hour: 17.5, weather: 0 } }, // Royal Mile / High Street
  { name: "Tokyo", lat: 35.6595, lon: 139.7005, preset: { hour: 19, weather: 0 } }, // Shibuya Crossing
  { name: "New York", lat: 40.758, lon: -73.9855, preset: { hour: 18, weather: 0 } }, // Times Square
];

const DEMO_MATCH_M = 300;

/** Nearest DEMO_PLACES entry within ~300 m of lat/lon, or null. */
export function demoPlaceNear(lat, lon, maxM = DEMO_MATCH_M) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let best = null;
  let bestD = maxM;
  for (const p of DEMO_PLACES) {
    const dy = (p.lat - lat) * 110540;
    const dx = (p.lon - lon) * 111320 * Math.cos((lat * Math.PI) / 180);
    const d = Math.hypot(dx, dy);
    if (d <= bestD) { best = p; bestD = d; }
  }
  return best;
}

/** Preset for a demo arrival at lat/lon (null when none applies). */
export function demoPresetNear(lat, lon) {
  return demoPlaceNear(lat, lon)?.preset ?? null;
}

/** /street URL; demo=1 asks the engine to apply the nearby demo preset once. */
export function streetUrl(lat, lon, { demo = false } = {}) {
  return `/street?lat=${lat}&lon=${lon}${demo ? "&demo=1" : ""}`;
}

export const PLACES = [
  { name: "New York", lat: 40.758, lon: -73.9855 }, // Times Square
  { name: "Paris", lat: 48.8698, lon: 2.3075 }, // Champs-Élysées
  { name: "Tokyo", lat: 35.6595, lon: 139.7005 }, // Shibuya Crossing
  { name: "London", lat: 51.5101, lon: -0.1344 }, // Piccadilly Circus
  { name: "Edinburgh", lat: 55.9505, lon: -3.1875 }, // Royal Mile / High Street
  { name: "Pune", lat: 18.5196, lon: 73.8554 }, // JM Road
  { name: "San Francisco", lat: 37.7793, lon: -122.4193 }, // Market Street
  { name: "Dubai", lat: 25.1985, lon: 55.2796 }, // Downtown boulevard
  { name: "Sydney", lat: -33.861, lon: 151.2105 }, // Circular Quay
  { name: "Rome", lat: 41.8925, lon: 12.4853 }, // Via dei Fori Imperiali
  { name: "Barcelona", lat: 41.3917, lon: 2.165 }, // Passeig de Gràcia
  { name: "Amsterdam", lat: 52.3731, lon: 4.8926 }, // Dam Square
  { name: "Berlin", lat: 52.5166, lon: 13.3809 }, // Unter den Linden
  { name: "Istanbul", lat: 41.0082, lon: 28.978 }, // Sultanahmet
  { name: "Singapore", lat: 1.2839, lon: 103.8607 }, // Marina Bay
  { name: "Rio de Janeiro", lat: -22.9698, lon: -43.1868 }, // Copacabana
  { name: "Mumbai", lat: 18.9438, lon: 72.8231 }, // Marine Drive
  { name: "Seoul", lat: 37.5714, lon: 126.9769 }, // Gwanghwamun
];
