import { PLACES } from '@/lib/geo';
import { SEED_GROUPS } from '@/lib/seedPlaces';

/** Flat list of every named walk spot (fast-travel + seed catalog). */
export function allDestinations() {
  const out = [...PLACES];
  const seen = new Set(PLACES.map((p) => p.name));
  for (const group of Object.values(SEED_GROUPS)) {
    for (const p of group) {
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      out.push(p);
    }
  }
  return out;
}

/** Deterministic pick from the catalog for a UTC calendar day. */
export function dailyDestination(date = new Date(), places = allDestinations()) {
  if (!places.length) return null;
  const seed = date.toISOString().slice(0, 10); // YYYY-MM-DD UTC
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return places[(h >>> 0) % places.length];
}

/** Random destination for Where-am-I (excludes optional name). */
export function randomDestination(excludeName = null, places = allDestinations()) {
  const pool = excludeName ? places.filter((p) => p.name !== excludeName) : places;
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Build a Where-am-I round: one answer + 3 distractors (shuffled).
 * @returns {{ answer: string, lat: number, lon: number, options: string[] } | null}
 */
export function whereAmIRound(places = allDestinations()) {
  const answer = randomDestination(null, places);
  if (!answer) return null;
  const options = new Set([answer.name]);
  let guard = 0;
  while (options.size < 4 && guard++ < 40) {
    const d = randomDestination(answer.name, places);
    if (d) options.add(d.name);
  }
  const list = [...options];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return { answer: answer.name, lat: answer.lat, lon: answer.lon, options: list };
}
