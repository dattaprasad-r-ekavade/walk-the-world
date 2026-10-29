// Exact-cell loading: one shared request, bounded CDN probe, then server-owned retries.
import { applyCellEnrichment } from "@/lib/engine/cell-enrichment";
import { cityCacheKey, isCompleteCity, validCityData } from "@/lib/city-contract";
import { readCityCache, writeCityCache } from "@/lib/engine/city-cache";
import { markPerf, measurePerfAsync, recordPerfTiming, recordPerfValidationError } from "@/lib/perf";
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

const RETRY_STATUS = new Set([502, 503, 504]);
const MAX_RETRY_WAIT = 8000;

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); };
    const onAbort = () => { done(); reject(signal.reason); };
    const timer = setTimeout(() => { done(); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelay(response) {
  const seconds = Number(response.headers.get("retry-after"));
  return Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000, MAX_RETRY_WAIT);
}

// retry: one extra attempt for transient 502/503/504, honoring a capped Retry-After.
async function readJson(url, signal, timeout, retry = false, source = "api") {
  const deadline = AbortSignal.timeout(timeout);
  let failedPhase = "fetch";
  let failedPhaseStartedAt = performance.now();
  try {
    for (let attempt = 0; ; attempt++) {
      const fetchStartedAt = performance.now();
      failedPhase = "fetch";
      failedPhaseStartedAt = fetchStartedAt;
      const response = await fetch(url, { signal: AbortSignal.any([signal, deadline]) });
      recordPerfTiming("city.fetch-to-headers", performance.now() - fetchStartedAt, {
        source,
        status: response.status,
        attempt: attempt + 1,
      });
      if (!response.ok) {
        if (retry && !attempt && RETRY_STATUS.has(response.status)) {
          await wait(retryDelay(response), AbortSignal.any([signal, deadline]));
          continue;
        }
        return null;
      }
      const jsonStartedAt = performance.now();
      failedPhase = "json-body-and-parse";
      failedPhaseStartedAt = jsonStartedAt;
      const data = await response.json();
      recordPerfTiming("city.json-body-and-parse", performance.now() - jsonStartedAt, {
        source,
        attempt: attempt + 1,
      });
      if (!validCityData(data)) {
        recordPerfValidationError("City response failed validation", {
          source,
          attempt: attempt + 1,
          elementCount: data?.elements?.length ?? null,
        });
        return null;
      }
      return slimCell(data);
    }
  } catch (error) {
    signal.throwIfAborted();
    recordPerfTiming("city.fetch-failed", performance.now() - failedPhaseStartedAt, {
      source,
      phase: failedPhase,
      message: String(error?.message || error),
    });
    return null;
  }
}

// The bucket's CORS policy only allows the production origin, so local previews
// use the same-origin rewrite in next.config.mjs instead of failing a direct read.
function publicR2Base() {
  const base = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE;
  if (!base) return "";
  const host = typeof location !== "undefined" ? location.hostname : "";
  return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(host) ? "/r2-public" : base;
}

async function loadCell(key, signal) {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.time < TTL && isCompleteCity(hit.data)) {
    markPerf("city-cache-hit", { tier: "memory" });
    return hit.data;
  }
  const cacheStartedAt = performance.now();
  let data = await readCityCache(key);
  recordPerfTiming("city.indexeddb-read", performance.now() - cacheStartedAt);
  signal.throwIfAborted();
  if (!isCompleteCity(data)) data = null;
  else markPerf("city-cache-hit", { tier: "indexeddb" });
  const base = publicR2Base();
  if (!data && base && Date.now() >= (misses.get(key) || 0)) {
    data = await readJson(`${base}/${key}.json`, signal, 5000, false, "public-r2");
    if (isCompleteCity(data)) markPerf("city-cache-hit", { tier: "public-r2" });
    if (!isCompleteCity(data)) {
      data = null;
      misses.set(key, Date.now() + 60000);
      if (misses.size > 128) misses.delete(misses.keys().next().value);
    }
  }
  // No browser Overpass fan-out: the API owns the entire retry budget.
  if (!data) {
    data = await readJson(`/api/city/${key}`, signal, 110000, true, "api");
    if (isCompleteCity(data)) markPerf("city-cache-miss", { source: "api" });
  }
  if (!data) throw new Error("City data unavailable. Please retry shortly.");
  const enrichmentStartedAt = performance.now();
  data = applyCellEnrichment(data);
  recordPerfTiming("city.enrichment", performance.now() - enrichmentStartedAt);
  data.partial = !isCompleteCity(data);
  if (!data.partial) {
    memory.delete(key);
    memory.set(key, { time: Date.now(), data });
    if (memory.size > 12) memory.delete(memory.keys().next().value);
    void writeCityCache(key, data);
  }
  return data;
}

/** @param {number} lat @param {number} lon @param {{signal?:AbortSignal, readonly?:boolean}} [options] */
// readonly: the caller promises not to mutate the result, so the defensive clone is skipped.
export function fetchCityData(lat, lon, { signal, readonly = false } = {}) {
  if (typeof window !== "undefined" && window.__BENCH_MODE && window.__BENCH_FIXTURE) {
    const copyStartedAt = performance.now();
    const result = readonly ? window.__BENCH_FIXTURE : structuredClone(window.__BENCH_FIXTURE);
    recordPerfTiming("city.consumer-copy", performance.now() - copyStartedAt, {
      elements: result?.elements?.length || 0,
      readonly,
    });
    return Promise.resolve(result);
  }
  if (signal?.aborted) return Promise.reject(signal.reason);
  const key = cityCacheKey(lat, lon);
  let entry = requests.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      users: new Set(),
      promise: measurePerfAsync("city.cell-load", () => loadCell(key, controller.signal)),
    };
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
      if (finish()) {
        const copyStartedAt = performance.now();
        const result = readonly ? data : structuredClone(data);
        recordPerfTiming("city.consumer-copy", performance.now() - copyStartedAt, {
          elements: data?.elements?.length || 0,
          readonly,
        });
        resolve(result); // editor mutations never contaminate cache/other consumers
      }
    }, error => { if (finish()) reject(error); });
  });
}

export async function fetchCityDataForStream(lat, lon, options) {
  // Streaming only reads cells (the worker clones on postMessage), so share the cached object.
  const data = await fetchCityData(lat, lon, { ...options, readonly: true });
  return { data, cacheKey: cityCacheKey(lat, lon), lat, lon };
}
