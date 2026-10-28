#!/usr/bin/env node
/**
 * Performance benchmark for Walk the World refactor.
 * Usage: node scripts/bench-perf.mjs [--base-url http://127.0.0.1:3456] [--out benchmarks/before.json]
 * Optional fixed walking pose: --pose-x <meters> --pose-z <meters> --heading <radians>.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { execFileSync, spawn } from 'child_process';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CELL_STEP, cityCacheKey } from '../lib/city-contract.js';
import { EARTH_R } from '../lib/engine/geo.js';
import { parseBenchmarkEnvironment } from './bench-environment.mjs';
import {
  orderedFrameIntervals,
  orderedGpuFrameTimes,
  orderedPerfTimeline,
  orderedResourceSamples,
  orderedRendererFrames,
  PERF_SCHEMA_VERSION,
  PERF_TIMING_LIMIT,
  summarizeDurationSamples,
  summarizeFrameIntervals,
  summarizeResourceStability,
  summarizeRendererFrames,
  validateBenchmarkMeasurement,
  validateResourceSoak,
} from '../lib/perf-summary.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Expected a value after ${name}`);
  return value;
}

const benchmarkEnvironment = parseBenchmarkEnvironment(args);

const baseUrl = option('--base-url', 'http://127.0.0.1:3456');
const outputOption = option('--out', join('benchmarks', 'results.json'));
const outPath = isAbsolute(outputOption) ? outputOption : resolve(ROOT, outputOption);
const screenshotOption = option('--screenshot', null);
const screenshotPath = screenshotOption
  ? (isAbsolute(screenshotOption) ? screenshotOption : resolve(ROOT, screenshotOption))
  : null;
const dataMode = option('--data-mode', 'fixture');
const fixtureOption = option('--fixture', join('benchmarks', 'fixtures', dataMode === 'recorded' ? 'rome-showcase-osm.json' : 'rome-minimal.json'));
const fixturePath = isAbsolute(fixtureOption) ? fixtureOption : resolve(ROOT, fixtureOption);
const cacheMode = option('--cache-mode', ['live', 'recorded'].includes(dataMode) ? 'cold' : 'none');
const route = option('--route', '/street');
const qualityPreset = option('--preset', 'medium');
const rendererMode = option('--renderer-mode', 'software');
const browserChannel = option('--browser-channel', 'bundled');
const walkDurationMs = Number(option('--walk-ms', '12000'));
const geometryWorkers = Number(option('--geometry-workers', '2'));
const cityDataCopyMode = option('--city-data-copy', 'readonly');
const profileCityQueries = args.includes('--profile-city-queries');
const roadQueryMode = option('--road-query-mode', 'indexed');
const seed = Number(option('--seed', '1337'));
const location = {
  lat: Number(option('--lat', '41.8902')),
  lon: Number(option('--lon', '12.4922')),
};
const headed = args.includes('--headed');
const skipGlobe = args.includes('--skip-globe');
const skipHostTelemetry = args.includes('--skip-host-telemetry');
const driving = args.includes('--drive');
const crossCell = args.includes('--cross-cell');
const resourceSoakEnabled = args.includes('--resource-soak');
const poseOptionNames = ['--pose-x', '--pose-z', '--heading'];
const suppliedPoseOptions = poseOptionNames.filter((name) => args.includes(name));
let fixedPose = null;
if (suppliedPoseOptions.length > 0) {
  if (suppliedPoseOptions.length !== poseOptionNames.length) {
    throw new Error('Provide all three fixed-pose options: --pose-x, --pose-z and --heading');
  }
  fixedPose = {
    x: Number(option('--pose-x', '')),
    z: Number(option('--pose-z', '')),
    heading: Number(option('--heading', '')),
  };
  if (!Object.values(fixedPose).every(Number.isFinite)) throw new Error('Fixed-pose values must be finite numbers');
  if (driving || crossCell) throw new Error('Fixed-pose options cannot be combined with --drive or --cross-cell');
}
if (!['low', 'medium', 'high'].includes(qualityPreset)) throw new Error('--preset must be low, medium, or high');
if (!['software', 'browser-default'].includes(rendererMode)) throw new Error('--renderer-mode must be software or browser-default');
if (!['bundled', 'chrome'].includes(browserChannel)) throw new Error('--browser-channel must be bundled or chrome');
if (!['fixture', 'recorded', 'live'].includes(dataMode)) throw new Error('--data-mode must be fixture, recorded, or live');
if (dataMode === 'fixture' && cacheMode !== 'none') {
  throw new Error('--cache-mode is only valid with --data-mode live or recorded');
}
if (['live', 'recorded'].includes(dataMode) && !['cold', 'warm'].includes(cacheMode)) {
  throw new Error('--cache-mode must be cold or warm with --data-mode live or recorded');
}
if (!Number.isFinite(walkDurationMs) || walkDurationMs < 1000) throw new Error('--walk-ms must be at least 1000');
if (!Number.isInteger(geometryWorkers) || geometryWorkers < 1 || geometryWorkers > 2) {
  throw new Error('--geometry-workers must be 1 or 2');
}
if (!['clone', 'readonly'].includes(cityDataCopyMode)) {
  throw new Error('--city-data-copy must be clone or readonly');
}
if (!['scan', 'indexed'].includes(roadQueryMode)) {
  throw new Error('--road-query-mode must be scan or indexed');
}
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be an integer from 0 to 4294967295');
if (!Number.isFinite(location.lat) || Math.abs(location.lat) > 90 || !Number.isFinite(location.lon) || Math.abs(location.lon) > 180) {
  throw new Error('Benchmark latitude/longitude are invalid');
}
if (!route.startsWith('/')) throw new Error('--route must be an absolute path such as /street');
if (resourceSoakEnabled && walkDurationMs < 900_000) {
  throw new Error('--resource-soak requires --walk-ms of at least 900000 (15 minutes)');
}
if (resourceSoakEnabled && !crossCell) throw new Error('--resource-soak requires --cross-cell to exercise streaming and eviction');
if (resourceSoakEnabled && driving) throw new Error('--resource-soak is a pedestrian walk and cannot be combined with --drive');
const READY_TIMEOUT = 180_000;
const HOST_TELEMETRY_READY_MARKER = '__BENCH_HOST_TELEMETRY_READY__';

const BENCH_FIXTURE = JSON.parse(readFileSync(fixturePath, 'utf8'));

function streetUrl() {
  const url = new URL(route, baseUrl);
  url.searchParams.set('lat', String(location.lat));
  url.searchParams.set('lon', String(location.lon));
  url.searchParams.set('bench', '1');
  return url.toString();
}

async function waitForSpawnCellCache(page, expectedKey) {
  await page.waitForFunction((cityKey) => {
    const state = window.__streetDebug?.cellStream?.();
    return window.__engineReady === true && state?.loadedKeys?.includes(cityKey);
  }, expectedKey, { timeout: READY_TIMEOUT });
  await page.waitForFunction(async (cityKey) => {
    if (typeof indexedDB === 'undefined') return false;
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('wtw-city-cache', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    });
    if (!db) return false;
    return new Promise((resolve) => {
      const request = db.transaction('cells', 'readonly').objectStore('cells').get(cityKey);
      request.onsuccess = () => resolve(!!request.result?.data?.elements?.length);
      request.onerror = () => resolve(false);
    });
  }, expectedKey, { timeout: READY_TIMEOUT });
}

function createNetworkRecorder(page, baseOrigin) {
  const records = new Map();
  const pendingSizes = new Set();
  const percentile = (values, fraction) => {
    const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
    return ordered.length ? Number(ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)].toFixed(1)) : null;
  };
  const categoryFor = (request) => {
    try {
      const url = new URL(request.url());
      if (url.origin === baseOrigin && /^\/api\/city\//.test(url.pathname)) return 'city-api';
      if (url.origin === baseOrigin && url.pathname.startsWith('/api/')) return 'app-api';
      if (url.origin === baseOrigin) return 'app-origin';
      return 'external';
    } catch { return 'unknown'; }
  };
  page.on('request', (request) => {
    records.set(request, {
      category: categoryFor(request),
      resourceType: request.resourceType(),
      status: null,
      failed: false,
      completed: false,
      responseBodySize: null,
      durationMs: null,
      serviceWorker: request.serviceWorker() !== null,
      cityKey: (() => {
        try { return new URL(request.url()).pathname.match(/^\/api\/city\/([^/]+)$/)?.[1] || null; }
        catch { return null; }
      })(),
    });
  });
  page.on('response', (response) => {
    const record = records.get(response.request());
    if (record) record.status = response.status();
  });
  page.on('requestfailed', (request) => {
    const record = records.get(request);
    if (record) {
      record.failed = true;
      record.failureText = request.failure()?.errorText || 'request failed';
    }
  });
  page.on('requestfinished', (request) => {
    const record = records.get(request);
    if (!record) return;
    record.completed = true;
    const readSizes = request.sizes().then((sizes) => {
      record.responseBodySize = Number.isFinite(sizes.responseBodySize) && sizes.responseBodySize >= 0
        ? sizes.responseBodySize
        : null;
      const timing = request.timing();
      if (Number.isFinite(timing.responseEnd) && timing.responseEnd >= 0) record.durationMs = timing.responseEnd;
    }).catch(() => {});
    pendingSizes.add(readSizes);
    readSizes.finally(() => pendingSizes.delete(readSizes));
  });
  return {
    async summary() {
      await Promise.allSettled([...pendingSizes]);
      const groups = {};
      const cityCells = {};
      for (const record of records.values()) {
        const group = groups[record.category] ||= {
          requests: 0,
          completed: 0,
          failed: 0,
          httpErrorResponses: 0,
          statusCodes: {},
          encodedResponseBytes: 0,
          requestsWithKnownSize: 0,
          serviceWorkerResponses: 0,
          requestDurationP50Ms: null,
          requestDurationP95Ms: null,
          durationsMs: [],
        };
        group.requests++;
        if (record.completed) group.completed++;
        if (record.failed) group.failed++;
        if (Number.isInteger(record.status)) {
          const statusCode = String(record.status);
          group.statusCodes[statusCode] = (group.statusCodes[statusCode] || 0) + 1;
          if (record.status >= 400) group.httpErrorResponses++;
        }
        if (record.serviceWorker) group.serviceWorkerResponses++;
        if (Number.isFinite(record.durationMs)) group.durationsMs.push(record.durationMs);
        if (Number.isFinite(record.responseBodySize)) {
          group.encodedResponseBytes += record.responseBodySize;
          group.requestsWithKnownSize++;
        }
        if (record.cityKey) {
          const cell = cityCells[record.cityKey] ||= {
            requests: 0,
            completed: 0,
            transportFailures: 0,
            transportFailureReasons: {},
            httpErrorResponses: 0,
            statusCodes: {},
            encodedResponseBytes: 0,
            requestsWithKnownSize: 0,
          };
          cell.requests++;
          if (record.completed) cell.completed++;
          if (record.failed) {
            cell.transportFailures++;
            const reason = record.failureText || 'request failed';
            cell.transportFailureReasons[reason] = (cell.transportFailureReasons[reason] || 0) + 1;
          }
          if (Number.isInteger(record.status)) {
            const statusCode = String(record.status);
            cell.statusCodes[statusCode] = (cell.statusCodes[statusCode] || 0) + 1;
            if (record.status >= 400) cell.httpErrorResponses++;
          }
          if (Number.isFinite(record.responseBodySize)) {
            cell.encodedResponseBytes += record.responseBodySize;
            cell.requestsWithKnownSize++;
          }
        }
      }
      for (const group of Object.values(groups)) {
        group.requestDurationP50Ms = percentile(group.durationsMs, 0.5);
        group.requestDurationP95Ms = percentile(group.durationsMs, 0.95);
        delete group.durationsMs;
      }
      return {
        scope: 'browser-visible requests on the measured street page; excludes server-side upstream fetches',
        totalRequests: records.size,
        completedRequests: [...records.values()].filter((record) => record.completed).length,
        incompleteRequests: [...records.values()].filter((record) => !record.completed && !record.failed).length,
        failedRequests: [...records.values()].filter((record) => record.failed).length,
        httpErrorResponses: [...records.values()].filter((record) => Number.isInteger(record.status) && record.status >= 400).length,
        statusCodes: [...records.values()].reduce((counts, record) => {
          if (Number.isInteger(record.status)) {
            const statusCode = String(record.status);
            counts[statusCode] = (counts[statusCode] || 0) + 1;
          }
          return counts;
        }, {}),
        encodedResponseBytes: [...records.values()].reduce((sum, record) => sum + (record.responseBodySize || 0), 0),
        requestsWithKnownSize: [...records.values()].filter((record) => Number.isFinite(record.responseBodySize)).length,
        cityApiCellsRequested: Object.keys(cityCells).sort(),
        cityApiCellResults: cityCells,
        byCategory: groups,
      };
    },
  };
}

function summarizeHostTelemetryWindow(telemetry, startedAt, endedAt) {
  if (!telemetry?.available || !Array.isArray(telemetry.samples)) {
    return { available: false, reason: telemetry?.reason || 'Host telemetry samples are unavailable' };
  }

  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  const samples = telemetry.samples.filter((sample) => {
    const sampledAtMs = Date.parse(sample.sampledAt);
    return Number.isFinite(sampledAtMs) && sampledAtMs >= startMs && sampledAtMs <= endMs;
  });
  const cpuValues = samples.map((sample) => sample.systemCpuPct).filter(Number.isFinite);
  const memoryValues = samples.map((sample) => sample.availableMemoryMb).filter(Number.isFinite);
  const gpu3dValues = samples.map((sample) => sample.gpu3dEnginePeakPct).filter(Number.isFinite);
  const expectedSampleCount = Number.isFinite(telemetry.actualSampleIntervalSeconds) && telemetry.actualSampleIntervalSeconds > 0
    ? Math.floor((endMs - startMs) / (telemetry.actualSampleIntervalSeconds * 1000)) + 1
    : null;
  const firstSampleAtMs = samples.length ? Date.parse(samples[0].sampledAt) : null;
  const lastSampleAtMs = samples.length ? Date.parse(samples[samples.length - 1].sampledAt) : null;
  const firstSampleOffsetMs = firstSampleAtMs === null ? null : Math.round(firstSampleAtMs - startMs);
  const lastSampleGapMs = lastSampleAtMs === null ? null : Math.round(endMs - lastSampleAtMs);
  const reasons = [];
  if (samples.length === 0) reasons.push('No host samples fell inside the browser measurement window');
  if (!expectedSampleCount) reasons.push('Actual host sample interval is unavailable');
  if (expectedSampleCount && samples.length / expectedSampleCount < 0.75) reasons.push('Host sample coverage was below 75%');
  if (firstSampleOffsetMs !== null && firstSampleOffsetMs > telemetry.actualSampleIntervalSeconds * 1500) {
    reasons.push('The first host sample was too far into the browser measurement window');
  }
  if (lastSampleGapMs !== null && lastSampleGapMs > telemetry.actualSampleIntervalSeconds * 1500) {
    reasons.push('The last host sample was too far before the browser measurement window ended');
  }

  return {
    available: true,
    sampleCount: samples.length,
    expectedSampleCount,
    coveragePct: expectedSampleCount ? Math.round((samples.length / expectedSampleCount) * 100) : null,
    actualSampleIntervalSeconds: telemetry.actualSampleIntervalSeconds,
    firstSampleOffsetMs,
    lastSampleGapMs,
    averageSystemCpuPct: cpuValues.length ? Number((cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length).toFixed(2)) : null,
    minimumAvailableMemoryMb: memoryValues.length ? Math.min(...memoryValues) : null,
    averagePerEngine3dPeakPct: gpu3dValues.length ? Number((gpu3dValues.reduce((sum, value) => sum + value, 0) / gpu3dValues.length).toFixed(2)) : null,
    valid: reasons.length === 0 && expectedSampleCount > 0,
    reasons,
  };
}

function startHostTelemetry(sampleSeconds) {
  if (skipHostTelemetry) {
    const result = { available: false, reason: 'Disabled by --skip-host-telemetry' };
    return { ready: Promise.resolve(result), finish: async () => result };
  }
  if (process.platform !== 'win32') {
    return {
      ready: Promise.resolve({ available: false, reason: `Windows host counters are unavailable on ${process.platform}` }),
      finish: async () => ({
        available: false,
        reason: `Windows host counters are unavailable on ${process.platform}`,
      }),
    };
  }

  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(__dir, 'bench-host-telemetry.ps1'),
    '-SampleSeconds', String(sampleSeconds),
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let pendingStdoutLine = '';
  let stderr = '';
  let resolveReady;
  let readyResolved = false;
  const ready = new Promise((resolveReadySignal) => { resolveReady = resolveReadySignal; });
  const signalReady = (value) => {
    if (readyResolved) return;
    readyResolved = true;
    resolveReady(value);
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    pendingStdoutLine += chunk;
    const lines = pendingStdoutLine.split(/\r?\n/);
    pendingStdoutLine = lines.pop() || '';
    for (const line of lines) {
      if (line.trim() === HOST_TELEMETRY_READY_MARKER) signalReady({ available: true });
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const completed = new Promise((resolveCompletion) => {
    child.once('error', (error) => {
      signalReady({ available: false, reason: error.message });
      resolveCompletion({ error: error.message });
    });
    child.once('close', (code, signal) => {
      if (pendingStdoutLine.trim() === HOST_TELEMETRY_READY_MARKER) signalReady({ available: true });
      if (!readyResolved) signalReady({ available: false, reason: `Host telemetry exited before its first sample (code ${code ?? 'unknown'})` });
      resolveCompletion({ code, signal });
    });
  });

  return {
    ready,
    finish: async () => {
      const status = await completed;
      if (status.error) return { available: false, reason: status.error };
      if (status.code !== 0) {
        return {
          available: false,
          reason: `Host telemetry exited with code ${status.code ?? 'unknown'}${status.signal ? ` (${status.signal})` : ''}`,
          stderr: stderr.trim() || null,
          stdout: stdout.trim() || null,
        };
      }
      try {
        const jsonOutput = stdout
          .split(/\r?\n/)
          .filter((line) => line.trim() !== HOST_TELEMETRY_READY_MARKER)
          .join('\n')
          .trim();
        return JSON.parse(jsonOutput);
      } catch (error) {
        return {
          available: false,
          reason: `Could not parse host telemetry JSON: ${error.message}`,
          stderr: stderr.trim() || null,
          stdout: stdout.trim() || null,
        };
      }
    },
  };
}

async function benchStreet(page) {
  const t0 = Date.now();
  await page.goto(streetUrl(), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(() =>
    window.__engineReady === true &&
    !!window.__streetDebug?.player &&
    !!window.__streetDebug?.population?.() &&
    (!window.__BENCH_START_POSE || window.__BENCH_POSE_APPLIED === true), null, {
    timeout: READY_TIMEOUT,
  });
  const loadMs = Date.now() - t0;

  if (driving) {
    await page.waitForFunction(() => window.__streetDebug?.population?.()?.counts?.cars > 0, null, {
      timeout: READY_TIMEOUT,
    });
  }
  let playerStart = await page.evaluate(({ useDriving, pose }) => {
    const player = window.__streetDebug?.player;
    if (!player) return null;
    if (useDriving) {
      const population = window.__streetDebug?.population?.();
      const near = population?.getNearestCar?.(player.x, player.z, Number.POSITIVE_INFINITY);
      if (!near) return null;
      player.x = near.x;
      player.z = near.z;
      player.heading = Math.PI - near.heading;
    }
    if (pose) {
      player.x = pose.x;
      player.z = pose.z;
      player.heading = pose.heading;
      player.pitch = 0;
      player.moving = false;
    }
    return { x: player.x, z: player.z, heading: player.heading, pitch: player.pitch };
  }, { useDriving: driving, pose: fixedPose });
  if (!playerStart) throw new Error('Street player debug state is unavailable');
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  if (driving) {
    await page.keyboard.press('c');
    await page.waitForFunction(() => window.__streetDebug?.vehicle?.active === true, null, { timeout: 5000 });
  }
  let cellStreamStart = null;
  let expectedCellKey = null;
  if (crossCell) {
    await page.waitForFunction(() => {
      const state = window.__streetDebug?.cellStream?.();
      return !!state && state.pendingCount === 0;
    }, null, { timeout: READY_TIMEOUT });
    const initialCellState = await page.evaluate(() => window.__streetDebug.cellStream());
    cellStreamStart = initialCellState.center.key;
    expectedCellKey = cityCacheKey(location.lat, location.lon + CELL_STEP);
    const crossingSetup = await page.evaluate(({ lat, lon, step, earthRadius, useDriving }) => {
      const debug = window.__streetDebug;
      const player = debug?.player;
      if (!player) throw new Error('Street player debug state is unavailable');
      const boundaryX = (step / 2) * Math.PI * earthRadius * Math.cos(lat * Math.PI / 180) / 180;
      const lead = useDriving ? 6 : 2;
      const startX = boundaryX - lead;
      const offsets = [0];
      for (let distance = 3; distance <= 300; distance += 3) offsets.push(distance, -distance);
      const pathOffsets = [-10, -7, -4, 0, 4, 7, 10];
      let clearZ = null;
      for (const offset of offsets) {
        const z = player.z + offset;
        if (pathOffsets.every((xOffset) => !debug.insideBuilding(startX + xOffset, z))) {
          clearZ = z;
          break;
        }
      }
      if (clearZ === null) throw new Error('No clear eastbound path found near the next cell boundary');
      const ground = debug.groundHeight(startX, clearZ);
      if (useDriving) {
        const car = debug.vehicle?.state;
        if (!car?.active) throw new Error('Vehicle did not enter driving mode');
        car.x = startX;
        car.z = clearZ;
        car.y = ground + 0.05;
        car.heading = Math.PI / 2;
        car.speed = 0.5;
        debug.population?.()?.setDrivenPose?.(car.carIndex, {
          x: car.x, y: car.y, z: car.z, heading: car.heading, speed: car.speed,
        });
      }
      player.x = startX;
      player.z = clearZ;
      player.heading = Math.PI / 2;
      return { x: startX, z: clearZ, boundaryX };
    }, { lat: location.lat, lon: location.lon, step: CELL_STEP, earthRadius: EARTH_R, useDriving: driving });
    playerStart = { x: crossingSetup.x, z: crossingSetup.z };
  }
  // Prime the counter provider while the scene is idle; begin movement only
  // after the first real host sample is available.
  await page.waitForTimeout(500);
  const hostTelemetryLimit = resourceSoakEnabled ? 1800 : 600;
  const hostTelemetryMonitor = startHostTelemetry(Math.min(hostTelemetryLimit, Math.max(1, Math.ceil(walkDurationMs / 1000) + 3)));
  await hostTelemetryMonitor.ready;
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  await page.evaluate((resourceSoak) => {
    const counters = window.__perfCounters;
    if (counters) {
      counters.frameIntervalsMs.length = 0;
      counters.frameIntervalCursor = 0;
      counters.rendererFrames.length = 0;
      counters.rendererFrameCursor = 0;
      counters.gpuFrameTimesMs.length = 0;
      counters.gpuFrameTimeCursor = 0;
      counters.fpsSamples.length = 0;
      counters.resourceSamples.length = 0;
      counters.resourceSampleCursor = 0;
    }
    window.__BENCH_FREEZE_POPULATION = false;
    const focusMonitor = { active: false, focusLossCount: 0, visibilityLossCount: 0 };
    window.__BENCH_FOCUS_MONITOR = focusMonitor;
    window.addEventListener('blur', () => {
      if (focusMonitor.active) focusMonitor.focusLossCount++;
    });
    document.addEventListener('visibilitychange', () => {
      if (focusMonitor.active && document.visibilityState !== 'visible') focusMonitor.visibilityLossCount++;
    });
    focusMonitor.active = true;
    if (resourceSoak) {
      const debug = window.__streetDebug;
      const player = debug?.player;
      const route = {
        pathDistanceMeters: 0,
        turnCount: 0,
        lastX: player?.x ?? 0,
        lastZ: player?.z ?? 0,
        timer: null,
      };
      const lookAhead = 24;
      const checkPath = (heading) => {
        const sin = Math.sin(heading), negCos = -Math.cos(heading);
        const sideX = Math.cos(heading), sideZ = Math.sin(heading);
        let clearMeters = 0;
        for (let distance = 2; distance <= lookAhead; distance += 2) {
          const x = player.x + sin * distance;
          const z = player.z + negCos * distance;
          if (debug.insideBuilding(x, z) ||
              debug.insideBuilding(x + sideX * 0.7, z + sideZ * 0.7) ||
              debug.insideBuilding(x - sideX * 0.7, z - sideZ * 0.7)) break;
          clearMeters = distance;
        }
        return clearMeters;
      };
      route.timer = window.setInterval(() => {
        if (!player || !debug?.insideBuilding) return;
        route.pathDistanceMeters += Math.hypot(player.x - route.lastX, player.z - route.lastZ);
        route.lastX = player.x;
        route.lastZ = player.z;
        if (checkPath(player.heading) >= 10) return;
        const choices = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, 3 * Math.PI / 4, -3 * Math.PI / 4, Math.PI];
        let bestHeading = player.heading;
        let bestScore = -Infinity;
        for (const delta of choices) {
          const heading = player.heading + delta;
          const score = checkPath(heading) + 2 * Math.cos(delta);
          if (score > bestScore) {
            bestScore = score;
            bestHeading = heading;
          }
        }
        if (Math.abs(Math.atan2(Math.sin(bestHeading - player.heading), Math.cos(bestHeading - player.heading))) > 0.05) {
          route.turnCount++;
          player.heading = bestHeading;
        }
      }, 750);
      window.__BENCH_RESOURCE_SOAK_NAV = route;
    }
  }, resourceSoakEnabled);
  const measurementStartedAt = new Date().toISOString();
  const measurementStartedMonotonicMs = await page.evaluate(() => performance.now());
  await page.keyboard.down('w');
  await page.waitForTimeout(walkDurationMs);
  await page.keyboard.up('w');
  const endState = await page.evaluate(() => {
    const navigation = window.__BENCH_RESOURCE_SOAK_NAV;
    if (navigation?.timer) window.clearInterval(navigation.timer);
    return {
      atMs: performance.now(),
      resourceSoakNavigation: navigation ? {
        pathDistanceMeters: navigation.pathDistanceMeters,
        turnCount: navigation.turnCount,
        obstacleAvoidance: true,
      } : null,
    };
  });
  const measurementEndedMonotonicMs = endState.atMs;
  const resourceSoakNavigation = endState.resourceSoakNavigation;
  const measurementEndedAt = new Date().toISOString();
  const wallElapsedMs = measurementEndedMonotonicMs - measurementStartedMonotonicMs;
  const metricsCapturedAt = new Date().toISOString();

  // Snapshot the browser counters immediately after movement. Host telemetry
  // cleanup and cell-stream settling can take seconds and must not extend this
  // frame history.
  const metrics = await page.evaluate(() => {
    const fpsChip = document.querySelector('.chip.fps');
    const fpsText = fpsChip?.textContent || '0 FPS';
    const fps = parseInt(fpsText, 10) || 0;
    const counters = window.__perfCounters ?? null;
    const focusMonitor = window.__BENCH_FOCUS_MONITOR;
    if (focusMonitor) focusMonitor.active = false;
    return {
      fps,
      triangles: window.__streetTriangles ?? null,
      perf: counters,
      cityBuilder: window.__streetDebug?.cityBuilder?.() || null,
      cityDataCopyMode: window.__streetDebug?.cityDataCopyMode || null,
      player: window.__streetDebug?.player ? {
        x: window.__streetDebug.player.x,
        z: window.__streetDebug.player.z,
      } : null,
      vehicleActive: window.__streetDebug?.vehicle?.active === true,
      streetLighting: window.__streetDebug?.streetLightStats?.() || null,
      environment: {
        ...(counters?.environment || {}),
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        focusLossCount: focusMonitor?.focusLossCount ?? null,
        visibilityLossCount: focusMonitor?.visibilityLossCount ?? null,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      },
      capturedAtBrowserMs: performance.now(),
    };
  });
  // Material census runs after the frame window is frozen so its scene walk
  // cannot perturb the measured movement interval.
  const materialInventory = await page.evaluate(() => window.__streetDebug?.materialInventory?.() || null);
  const hostTelemetryPromise = hostTelemetryMonitor.finish();

  let cellStreaming = null;
  if (crossCell) {
    try {
      await page.waitForFunction(({ expectedKey, startKey, resourceSoak }) => {
        const state = window.__streetDebug?.cellStream?.();
        if (resourceSoak) {
          const centerKey = state?.center?.key;
          return !!centerKey && centerKey !== startKey &&
            state.loadedKeys.includes(centerKey) && state.pendingCount === 0;
        }
        return state?.center?.key === expectedKey &&
          state.loadedKeys.includes(expectedKey) && state.pendingCount === 0;
      }, { expectedKey: expectedCellKey, startKey: cellStreamStart, resourceSoak: resourceSoakEnabled }, { timeout: READY_TIMEOUT });
    } catch { /* return the last state so a failed crossing remains diagnosable */ }
    cellStreaming = await page.evaluate(({ startKey, expectedKey, resourceSoak }) => {
      const state = window.__streetDebug?.cellStream?.();
      const endKey = state?.center?.key || null;
      const crossed = !!endKey && endKey !== startKey && (resourceSoak || endKey === expectedKey);
      const neighborLoaded = !!state?.loadedKeys?.includes(resourceSoak ? endKey : expectedKey);
      const settled = state?.pendingCount === 0;
      const noFailedCells = !!state && state.failedKeys.length === 0;
      const resourceLimitOk = !!state && state.residentCellCount <= state.maxCells;
      return {
        startCellKey: startKey,
        expectedCellKey: expectedKey,
        endCellKey: endKey,
        crossed,
        neighborLoaded,
        settled,
        residentCellCount: state?.residentCellCount ?? null,
        maxCells: state?.maxCells ?? null,
        failedCellKeys: state?.failedKeys || [],
        noFailedCells,
        resourceLimitOk,
        resourceSoak,
        validated: crossed && neighborLoaded && settled && noFailedCells && resourceLimitOk,
      };
    }, { startKey: cellStreamStart, expectedKey: expectedCellKey, resourceSoak: resourceSoakEnabled });
  }

  const hostTelemetry = await hostTelemetryPromise;
  const displacementMeters = metrics.player
    ? Math.hypot(metrics.player.x - playerStart.x, metrics.player.z - playerStart.z)
    : null;

  const samples = metrics.perf?.fpsSamples ?? [];
  const frameIntervalsMs = orderedFrameIntervals(metrics.perf);
  const frameSummary = summarizeFrameIntervals(frameIntervalsMs);
  const rendererFrames = orderedRendererFrames(metrics.perf);
  const gpuFrameTimesMs = orderedGpuFrameTimes(metrics.perf);
  const measurementWindow = validateBenchmarkMeasurement({
    requestedWalkMs: walkDurationMs,
    wallElapsedMs,
    frameDurationMs: frameSummary.durationMs,
    frameSampleCount: frameIntervalsMs.length,
    rendererSampleCount: rendererFrames.length,
    gpuSampleCount: gpuFrameTimesMs.length,
    visibilityState: metrics.environment.visibilityState,
    pageHasFocus: metrics.environment.hasFocus,
    focusLossCount: metrics.environment.focusLossCount ?? 0,
    visibilityLossCount: metrics.environment.visibilityLossCount ?? 0,
  });
  measurementWindow.startedAt = measurementStartedAt;
  measurementWindow.endedAt = measurementEndedAt;
  measurementWindow.browserMetricsCapturedAt = metricsCapturedAt;
  measurementWindow.capturedAtBrowserMs = metrics.capturedAtBrowserMs;
  measurementWindow.hostTelemetry = summarizeHostTelemetryWindow(hostTelemetry, measurementStartedAt, measurementEndedAt);
  if (resourceSoakEnabled) measurementWindow.frameWindowNotApplicable = true;
  const resourceSamples = orderedResourceSamples(metrics.perf);
  const resourceSoak = resourceSoakEnabled ? {
    validation: validateResourceSoak({
      requestedWalkMs: walkDurationMs,
      wallElapsedMs,
      resourceSamples,
      movementPathMeters: resourceSoakNavigation?.pathDistanceMeters ?? 0,
      visibilityState: metrics.environment.visibilityState,
      pageHasFocus: metrics.environment.hasFocus,
      focusLossCount: metrics.environment.focusLossCount ?? 0,
      visibilityLossCount: metrics.environment.visibilityLossCount ?? 0,
    }),
    stability: summarizeResourceStability(resourceSamples, {
      startAtMs: measurementStartedMonotonicMs,
      durationMs: Math.max(0, metrics.capturedAtBrowserMs - measurementStartedMonotonicMs),
    }),
    navigation: resourceSoakNavigation,
  } : null;
  const avgFps = frameSummary.meanFrameTimeMs
    ? Math.round(1000 / frameSummary.meanFrameTimeMs)
    : samples.length > 0
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : metrics.fps;

  return {
    loadMs,
    avgFps,
    movement: {
      start: playerStart,
      end: metrics.player,
      displacementMeters,
      validated: displacementMeters !== null && displacementMeters > 0.25,
    },
    driving: metrics.vehicleActive,
    cellStreaming,
    preset: qualityPreset,
    fpsSamples: samples,
    frameSummary,
    measurementWindow,
    resourceSoak,
    resourceSamples: resourceSoakEnabled ? resourceSamples : undefined,
    frameIntervalsMs,
    rendererFrameSummary: summarizeRendererFrames(rendererFrames),
    rendererFrames,
    gpuFrameSummary: summarizeDurationSamples(gpuFrameTimesMs),
    gpuFrameTimesMs,
    gpuTimer: metrics.perf?.gpuTimer || null,
    marks: metrics.perf?.marks || {},
    timings: orderedPerfTimeline(metrics.perf),
    timingHistory: {
      sampleCount: metrics.perf?.timeline?.length || 0,
      capacity: PERF_TIMING_LIMIT,
      wrapped: (metrics.perf?.timelineCursor || 0) > 0,
    },
    metadata: metrics.perf?.metadata || {},
    settings: metrics.perf?.settings || {},
    cityBuilder: metrics.cityBuilder,
    cityDataCopyMode: metrics.cityDataCopyMode,
    streetLighting: metrics.streetLighting,
    resourceCounts: metrics.perf?.resourceCounts || {},
    materialInventory,
    unavailableMeasurements: metrics.perf?.unavailableMeasurements || [],
    validationErrors: metrics.perf?.validationErrors || [],
    hostTelemetry,
    environment: metrics.environment,
    triangles: metrics.triangles,
    reactRenders: metrics.perf?.reactRenders ?? null,
    minimapDraws: metrics.perf?.minimapDraws ?? null,
    hudUpdates: metrics.perf?.hudUpdates ?? null,
  };
}

async function benchGlobe(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('button[data-testid="guided-demo"]:not([disabled])', {
    timeout: 120_000,
  });
  await page.click('button[data-testid="guided-demo"]');
  await page.waitForTimeout(4000);

  await page.keyboard.down('w');
  await page.waitForTimeout(walkDurationMs);
  await page.keyboard.up('w');
  await page.waitForTimeout(500);

  const metrics = await page.evaluate(() => window.__perfCounters ?? {});

  return {
    reactRenders: metrics.reactRenders ?? null,
    statusUpdates: metrics.statusUpdates ?? null,
    minimapDraws: metrics.minimapDraws ?? null,
  };
}

async function main() {
  console.log(`Benchmark → ${baseUrl}`);
  mkdirSync(dirname(outPath), { recursive: true });

  console.log(`  Fixture: ${fixturePath}`);
  console.log(`  Route: ${route}; data: ${dataMode}; cache: ${cacheMode}; preset: ${qualityPreset}; geometry workers: ${geometryWorkers}; city data copy: ${cityDataCopyMode}; road query: ${roadQueryMode}; browser: ${browserChannel}; renderer: ${rendererMode}; hour: ${benchmarkEnvironment.hour}; weather: ${benchmarkEnvironment.weather}; walk: ${walkDurationMs}ms${crossCell ? '; crossing a cell boundary' : ''}${resourceSoakEnabled ? '; resource soak' : ''}`);

  const launchOptions = {
    headless: !headed,
    args: rendererMode === 'software' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
  };
  if (browserChannel === 'chrome') launchOptions.channel = 'chrome';
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();
  const baseOrigin = new URL(baseUrl).origin;
  if (dataMode === 'recorded') {
    const fixtureBody = JSON.stringify(BENCH_FIXTURE);
    await context.route((url) => url.origin === baseOrigin && /^\/api\/city\//.test(url.pathname), (routeRequest) =>
      routeRequest.fulfill({ status: 200, contentType: 'application/json', body: fixtureBody })
    );
  }
  if (['fixture', 'recorded'].includes(dataMode)) {
    await context.route((url) => url.origin === baseOrigin && url.pathname === '/api/assets', (routeRequest) =>
      routeRequest.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
  }
  await context.addInitScript(({ fixture, schemaVersion, preset, seed, pose, environment, geometryWorkers, cityDataCopyMode, profileCityQueries, roadQueryMode }) => {
    if (location.origin !== 'null') {
      try {
        const saved = JSON.parse(localStorage.getItem('wtw-game') || '{}');
        saved.state = {
          ...(saved.state || {}),
          settings: {
            ...(saved.state?.settings || {}),
            quality: preset,
            qualityMode: 'manual',
            hour: environment.hour,
            weather: environment.weather,
          },
        };
        localStorage.setItem('wtw-game', JSON.stringify(saved));
      } catch { /* the benchmark still records the active runtime preset */ }
    }
    window.__BENCH_MODE = true;
    window.__BENCH_GEOMETRY_WORKERS = geometryWorkers;
    window.__BENCH_CITY_DATA_COPY_MODE = cityDataCopyMode;
    window.__BENCH_PROFILE_CITY_QUERIES = profileCityQueries;
    window.__BENCH_ROAD_QUERY_MODE = roadQueryMode;
    window.__BENCH_SEED = seed;
    window.__BENCH_FIXTURE = fixture;
    window.__BENCH_START_POSE = pose;
    window.__BENCH_ENVIRONMENT = environment;
    window.__BENCH_POSE_APPLIED = false;
    window.__BENCH_FREEZE_POPULATION = true;
    window.__perfCounters = {
      schemaVersion,
      startedAt: performance.now(),
      diagnosticsEnabled: true,
      reactRenders: 0,
      minimapDraws: 0,
      statusUpdates: 0,
      hudUpdates: 0,
      fpsSamples: [],
      frameIntervalsMs: [],
      frameIntervalCursor: 0,
      resourceCounts: {},
      resourceSamples: [],
      resourceSampleCursor: 0,
      timeline: [],
      timelineCursor: 0,
      marks: {},
      metadata: {},
      validationErrors: [],
    };
  }, {
    fixture: dataMode === 'fixture' ? BENCH_FIXTURE : null,
    schemaVersion: PERF_SCHEMA_VERSION,
    preset: qualityPreset,
    seed,
    pose: fixedPose,
    environment: benchmarkEnvironment,
    geometryWorkers,
    cityDataCopyMode,
    roadQueryMode,
    profileCityQueries,
  });

  let cache = dataMode === 'fixture'
    ? { ok: true, mode: 'none', skipped: true, reason: 'Fixture mode bypasses city API and browser city cache' }
    : dataMode === 'recorded'
      ? { ok: true, mode: 'cold', primed: false, protocol: 'Fresh Playwright browser context; city API responses are replayed from the checked-in OSM fixture' }
      : { ok: true, mode: 'cold', primed: false, protocol: 'Fresh Playwright browser context; upstream server and CDN caches are outside this control' };
  if (['live', 'recorded'].includes(dataMode) && cacheMode === 'warm') {
    console.log('  Warming origin city cell in IndexedDB…');
    const warmStartedAt = Date.now();
    const warmPage = await context.newPage();
    try {
      await warmPage.goto(streetUrl(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForSpawnCellCache(warmPage, cityCacheKey(location.lat, location.lon));
      cache = {
        ok: true,
        mode: 'warm',
        primed: true,
        indexedDbCellVerified: true,
        prewarmMs: Date.now() - warmStartedAt,
        protocol: dataMode === 'recorded'
          ? 'Loaded the recorded origin city cell through the app API, verified its IndexedDB entry, then measured a new page in the same browser context'
          : 'Loaded origin city cell, verified its IndexedDB entry, then measured a new page in the same browser context',
      };
    } catch (error) {
      cache = {
        ok: false,
        mode: 'warm',
        primed: false,
        prewarmMs: Date.now() - warmStartedAt,
        error: error.message,
      };
    } finally {
      await warmPage.close();
    }
  }
  const page = await context.newPage();
  const browserDiagnostics = { consoleErrors: [], pageErrors: [], assetFailures: [] };
  const networkRecorder = createNetworkRecorder(page, baseOrigin);
  const isLocalAsset = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === baseOrigin && (
        parsed.pathname.startsWith('/_next/static/') ||
        /\.(?:js|css|png|jpe?g|webp|svg|glb|gltf|ktx2|woff2?)$/i.test(parsed.pathname)
      );
    } catch { return false; }
  };
  page.on('console', (message) => {
    if (message.type() === 'error') browserDiagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserDiagnostics.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400 && isLocalAsset(response.url())) {
      browserDiagnostics.assetFailures.push({ url: response.url(), status: response.status() });
    }
  });
  page.on('requestfailed', (request) => {
    if (isLocalAsset(request.url())) {
      browserDiagnostics.assetFailures.push({ url: request.url(), error: request.failure()?.errorText || 'request failed' });
    }
  });

  const result = {
    schemaVersion: PERF_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    sourceRevision: (() => {
      try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
      catch { return null; }
    })(),
    sourceTreeDirty: (() => {
      try { return execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0; }
      catch { return null; }
    })(),
    baseUrl,
    browser: {
      name: 'Chromium',
      version: browser.version(),
      channel: browserChannel,
      rendererMode,
      headless: !headed,
    },
    scenario: {
      fixture: fixtureOption,
      route,
      latitude: location.lat,
      longitude: location.lon,
      qualityPreset,
      hour: benchmarkEnvironment.hour,
      weather: benchmarkEnvironment.weather,
      precipitationMode: benchmarkEnvironment.precipitationMode,
      walkDurationMs,
      seed,
      dataMode,
      cacheMode,
      driving,
      crossCell,
      geometryWorkers,
      cityDataCopyMode,
      roadQueryMode,
      profileCityQueries,
      resourceSoak: resourceSoakEnabled,
      fixedPose,
      populationFrozenUntilMeasurement: true,
      hostTelemetryEnabled: !skipHostTelemetry && process.platform === 'win32',
    },
    cityCacheWarm: cache,
    networkTelemetry: null,
    street: null,
    globe: null,
    error: null,
  };

  try {
    if (['live', 'recorded'].includes(dataMode) && cacheMode === 'warm' && !cache.ok) {
      throw new Error(`Warm-cache preparation failed: ${cache.error || 'origin city cell was not persisted'}`);
    }
    console.log('  Street engine…');
    result.street = await benchStreet(page);
    if (result.street.cityBuilder?.workerCount !== geometryWorkers) {
      throw new Error(`Requested ${geometryWorkers} geometry worker(s), but the engine reported ${result.street.cityBuilder?.workerCount ?? 'unknown'}`);
    }
    if (result.street.cityDataCopyMode !== cityDataCopyMode) {
      throw new Error(`Requested ${cityDataCopyMode} city data mode, but the engine reported ${result.street.cityDataCopyMode ?? 'unknown'}`);
    }
    if (profileCityQueries && !result.street.timings.some((event) => event.name === 'city.worker-poi-road-query' && event.details?.mode === roadQueryMode)) {
      throw new Error(`Requested ${roadQueryMode} road query mode, but the worker did not confirm it in profile timing.`);
    }
    if (resourceSoakEnabled && !result.street.resourceSoak?.validation?.valid) {
      throw new Error(`Resource soak validation failed: ${result.street.resourceSoak?.validation?.reasons?.join('; ') || 'missing resource samples'}`);
    }
    result.networkTelemetry = await networkRecorder.summary();
    if (result.street.settings?.hour !== benchmarkEnvironment.hour || result.street.settings?.weather !== benchmarkEnvironment.weather) {
      throw new Error(`Applied scene environment did not match the requested benchmark: ${JSON.stringify(result.street.settings)}`);
    }
    result.hostTelemetry = result.street.hostTelemetry;
    if (screenshotPath) {
      mkdirSync(dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, animations: 'disabled' });
      console.log(`    screenshot: ${screenshotPath}`);
    }
    if (!resourceSoakEnabled && !result.street.measurementWindow?.valid) {
      throw new Error(`Measurement window is invalid: ${result.street.measurementWindow?.reasons?.join('; ') || 'missing window diagnostics'}`);
    }
    console.log(
      `    load: ${result.street.loadMs}ms, avg FPS: ${result.street.avgFps}, movement: ${result.street.movement.displacementMeters?.toFixed(2) ?? 'n/a'}m`
    );
    if (!result.street.movement.validated) throw new Error('Street movement did not exceed 0.25m; controls were not validated');
    if (crossCell && !result.street.cellStreaming?.validated) {
      throw new Error(`Cell-crossing validation failed: ${JSON.stringify(result.street.cellStreaming)}`);
    }

    if (skipGlobe) result.globe = { skipped: true };
    else {
      console.log('  Globe page…');
      result.globe = await benchGlobe(page);
      console.log(
        `    status updates: ${result.globe.statusUpdates}, react renders: ${result.globe.reactRenders}, minimap draws: ${result.globe.minimapDraws}`
      );
    }
  } catch (e) {
    result.error = e.message;
    console.error('Benchmark failed:', e.message);
  }

  if (!result.networkTelemetry) result.networkTelemetry = await networkRecorder.summary();

  result.diagnostics = browserDiagnostics;
  const browserFailures = [
    ...browserDiagnostics.consoleErrors,
    ...browserDiagnostics.pageErrors,
    ...browserDiagnostics.assetFailures.map((failure) => JSON.stringify(failure)),
  ];
  if (browserFailures.length) {
    result.error ||= `Browser reported ${browserFailures.length} console, runtime, or local asset error(s)`;
    console.error(`Browser diagnostics reported ${browserFailures.length} failure(s)`);
  }

  await browser.close();
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Saved → ${outPath}`);
  if (result.error) process.exit(1);
}

main();
