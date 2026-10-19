// Exact-cell loading: one shared request, bounded CDN probe, then server-owned retries.
import { applyCellEnrichment } from "@/lib/engine/cell-enrichment";
import { cityCacheKey, isCompleteCity, validCityData } from "@/lib/city-contract";
import { readCityCache, writeCityCache } from "@/lib/engine/city-cache";
export { cityCacheKey };
const requests = new Map();
const misses = new Map();
const memory = new Map();
const TTL = 7 * 864e5;

export function slimCell(data) {
  if (!data?.elements) return data;
  for (const el of data.elements) { delete el.nodes; delete el.bounds; }
  return data;
}

async function readJson(url, signal, timeout) {
  try {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
    if (!response.ok) return null;
    const data = await response.json();
    return validCityData(data) ? slimCell(data) : null;
  } catch { signal.throwIfAborted(); return null; }
}

async function loadCell(key, signal) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.time < TTL && isCompleteCity(hit.data)) return hit.data;
  let data = await readCityCache(key);
  signal.throwIfAborted();
  if (!isCompleteCity(data)) data = null;
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE;
  if (!data && base && Date.now() >= (misses.get(key) || 0)) {
    data = await readJson(`${base}/${key}.json`, signal, 5000);
    if (!isCompleteCity(data)) {
      data = null;
      misses.set(key, Date.now() + 60000);
      if (misses.size > 128) misses.delete(misses.keys().next().value);
    }
  }
  // No browser Overpass fan-out: the API owns the entire retry budget.
  if (!data) data = await readJson(`/api/city/${key}`, signal, 110000);
  if (!data) throw new Error("City data unavailable. Please retry shortly.");
  data = applyCellEnrichment(data);
  data.partial = !isCompleteCity(data);
  if (!data.partial) {
    memory.delete(key);
    memory.set(key, { time: Date.now(), data });
    if (memory.size > 12) memory.delete(memory.keys().next().value);
    void writeCityCache(key, data);
  }
  return data;
}

/** @param {number} lat @param {number} lon @param {{signal?:AbortSignal}} [options] */
export function fetchCityData(lat, lon, { signal } = {}) {
  if (typeof window !== "undefined" && window.__BENCH_MODE && window.__BENCH_FIXTURE) {
    return Promise.resolve(structuredClone(window.__BENCH_FIXTURE));
  }
  if (signal?.aborted) return Promise.reject(signal.reason);
  const key = cityCacheKey(lat, lon);
  let entry = requests.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, users: new Set(), promise: loadCell(key, controller.signal) };
    requests.set(key, entry);
    entry.promise.finally(() => { if (requests.get(key) === entry) requests.delete(key); }).catch(() => {});
  }
  const user = {};
  entry.users.add(user);
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener("abort", abort);
      entry.users.delete(user);
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      reject(signal.reason);
      if (!entry.users.size) {
        entry.controller.abort();
        if (requests.get(key) === entry) requests.delete(key);
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    entry.promise.then(data => {
      if (finish()) resolve(structuredClone(data)); // editor mutations never contaminate cache/other consumers
    }, error => { if (finish()) reject(error); });
  });
}

export async function fetchCityDataForStream(lat, lon, options) {
  const data = await fetchCityData(lat, lon, options);
  return { data, cacheKey: cityCacheKey(lat, lon), lat, lon };
}
export const fetchCityDataNear = fetchCityDataForStream;
