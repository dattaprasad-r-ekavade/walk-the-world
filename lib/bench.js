// @ts-check
// Benchmark hooks for the street engine, read in one place.
//
// The Playwright harnesses (scripts/bench-perf.mjs, scripts/validate-street.mjs)
// configure a run by setting `window.__BENCH_*` globals in an init script. The
// engine never reads those globals directly: it asks this module once per
// mount and gets a plain config object. Outside a benchmark the config is the
// frozen `BENCH_OFF` value, so production code paths only ever test
// `bench.enabled` or read a neutral default.

/** @typedef {{ x: number, z: number, heading: number }} BenchPose */

/**
 * @typedef {object} BenchConfig
 * @property {boolean} enabled
 * @property {boolean} readOnlyCityData  Share the cached city payload instead of deep-cloning it.
 * @property {boolean} profileCityQueries
 * @property {"indexed" | "scan"} roadQueryMode
 * @property {number | null} geometryWorkers  Fixed worker-pool size, or null for the default.
 * @property {number | null} renderScale      Fixed render scale, or null to let the governor decide.
 * @property {boolean} collectShadowTargets
 * @property {BenchPose | null} startPose
 * @property {number} seed
 * @property {boolean} freezePopulation        Live: the harness flips this mid-run.
 * @property {boolean} hideInactiveStreetLights Live: the harness flips this mid-run.
 * @property {() => void} markPoseApplied
 */

const win = () => (typeof window === "undefined" ? undefined : window);

/** @type {Readonly<BenchConfig>} */
export const BENCH_OFF = Object.freeze({
  enabled: false,
  readOnlyCityData: true,
  profileCityQueries: false,
  roadQueryMode: "indexed",
  geometryWorkers: null,
  renderScale: null,
  collectShadowTargets: false,
  startPose: null,
  seed: 1337,
  freezePopulation: false,
  hideInactiveStreetLights: false,
  markPoseApplied: () => {},
});

/**
 * Bench hooks stay inert on production builds unless they were built with
 * NEXT_PUBLIC_ENABLE_BENCH=1 (npm run build:bench).
 */
export function benchAllowed() {
  return process.env.NEXT_PUBLIC_ENABLE_BENCH === "1" || process.env.NODE_ENV !== "production";
}

/** True while a benchmark harness drives this page. */
export function isBenchMode() {
  return win()?.__BENCH_MODE === true;
}

/** Turns bench mode on for a `?bench=1` visit where the build allows it. */
export function requestBenchMode(requested) {
  const w = win();
  if (w && requested && benchAllowed()) w.__BENCH_MODE = true;
}

/** @returns {Readonly<BenchConfig>} */
export function readBenchConfig() {
  const w = win();
  if (!w || w.__BENCH_MODE !== true) return BENCH_OFF;
  return Object.freeze({
    enabled: true,
    readOnlyCityData: w.__BENCH_CITY_DATA_COPY_MODE !== "clone",
    profileCityQueries: w.__BENCH_PROFILE_CITY_QUERIES === true,
    roadQueryMode: w.__BENCH_ROAD_QUERY_MODE === "scan" ? "scan" : "indexed",
    geometryWorkers: Number.isInteger(w.__BENCH_GEOMETRY_WORKERS) ? w.__BENCH_GEOMETRY_WORKERS : null,
    renderScale: Number.isFinite(w.__BENCH_RENDER_SCALE) ? w.__BENCH_RENDER_SCALE : null,
    collectShadowTargets: w.__BENCH_SHADOW_TARGETS === true,
    startPose: w.__BENCH_START_POSE || null,
    seed: Number.isInteger(w.__BENCH_SEED) ? w.__BENCH_SEED : 1337,
    get freezePopulation() { return w.__BENCH_FREEZE_POPULATION === true; },
    get hideInactiveStreetLights() { return w.__BENCH_HIDE_INACTIVE_STREET_LIGHTS === true; },
    markPoseApplied: () => { w.__BENCH_POSE_APPLIED = true; },
  });
}

/** Checked-in OSM fixture the harness injects in place of a network fetch. */
export function benchCityFixture() {
  const w = win();
  return w?.__BENCH_MODE && w.__BENCH_FIXTURE ? w.__BENCH_FIXTURE : null;
}

// Readiness signals the harnesses poll.
export function setEngineReady(ready) {
  const w = win();
  if (w) w.__engineReady = ready;
}
export function isEngineReady() {
  return win()?.__engineReady === true;
}
export function setStreetTriangles(count) {
  const w = win();
  if (w) w.__streetTriangles = count;
}
