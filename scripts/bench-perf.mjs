#!/usr/bin/env node
/**
 * Performance benchmark for Walk the World refactor.
 * Usage: node scripts/bench-perf.mjs [--base-url http://127.0.0.1:3456] [--out benchmarks/before.json]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, isAbsolute, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CELL_STEP, cityCacheKey } from '../lib/city-contract.js';
import { EARTH_R } from '../lib/engine/geo.js';
import {
  orderedFrameIntervals,
  orderedGpuFrameTimes,
  orderedPerfTimeline,
  orderedRendererFrames,
  PERF_SCHEMA_VERSION,
  summarizeDurationSamples,
  summarizeFrameIntervals,
  summarizeRendererFrames,
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

const baseUrl = option('--base-url', 'http://127.0.0.1:3456');
const outputOption = option('--out', join('benchmarks', 'results.json'));
const outPath = isAbsolute(outputOption) ? outputOption : resolve(ROOT, outputOption);
const screenshotOption = option('--screenshot', null);
const screenshotPath = screenshotOption
  ? (isAbsolute(screenshotOption) ? screenshotOption : resolve(ROOT, screenshotOption))
  : null;
const fixtureOption = option('--fixture', join('benchmarks', 'fixtures', 'rome-minimal.json'));
const fixturePath = isAbsolute(fixtureOption) ? fixtureOption : resolve(ROOT, fixtureOption);
const route = option('--route', '/street');
const qualityPreset = option('--preset', 'medium');
const rendererMode = option('--renderer-mode', 'software');
const walkDurationMs = Number(option('--walk-ms', '12000'));
const seed = Number(option('--seed', '1337'));
const location = {
  lat: Number(option('--lat', '41.8902')),
  lon: Number(option('--lon', '12.4922')),
};
const headed = args.includes('--headed');
const skipGlobe = args.includes('--skip-globe');
const driving = args.includes('--drive');
const crossCell = args.includes('--cross-cell');
if (!['low', 'medium', 'high'].includes(qualityPreset)) throw new Error('--preset must be low, medium, or high');
if (!['software', 'browser-default'].includes(rendererMode)) throw new Error('--renderer-mode must be software or browser-default');
if (!Number.isFinite(walkDurationMs) || walkDurationMs < 1000) throw new Error('--walk-ms must be at least 1000');
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be an integer from 0 to 4294967295');
if (!Number.isFinite(location.lat) || Math.abs(location.lat) > 90 || !Number.isFinite(location.lon) || Math.abs(location.lon) > 180) {
  throw new Error('Benchmark latitude/longitude are invalid');
}
if (!route.startsWith('/')) throw new Error('--route must be an absolute path such as /street');
const READY_TIMEOUT = 180_000;

const BENCH_FIXTURE = JSON.parse(readFileSync(fixturePath, 'utf8'));

async function benchStreet(page) {
  const t0 = Date.now();
  const streetUrl = new URL(route, baseUrl);
  streetUrl.searchParams.set('lat', String(location.lat));
  streetUrl.searchParams.set('lon', String(location.lon));
  streetUrl.searchParams.set('bench', '1');
  await page.goto(streetUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.__engineReady === true && !!window.__streetDebug?.player, null, {
    timeout: READY_TIMEOUT,
  });
  const loadMs = Date.now() - t0;

  if (driving) {
    await page.waitForFunction(() => window.__streetDebug?.population?.()?.counts?.cars > 0, null, {
      timeout: READY_TIMEOUT,
    });
  }
  let playerStart = await page.evaluate((useDriving) => {
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
    return { x: player.x, z: player.z };
  }, driving);
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
  // Let startup GPU queries finish before the measured movement window begins.
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const counters = window.__perfCounters;
    if (!counters) return;
    counters.frameIntervalsMs.length = 0;
    counters.frameIntervalCursor = 0;
    counters.rendererFrames.length = 0;
    counters.rendererFrameCursor = 0;
    counters.gpuFrameTimesMs.length = 0;
    counters.gpuFrameTimeCursor = 0;
    counters.fpsSamples.length = 0;
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(walkDurationMs);
  await page.keyboard.up('w');
  await page.waitForTimeout(500);

  let cellStreaming = null;
  if (crossCell) {
    try {
      await page.waitForFunction(({ expectedKey }) => {
        const state = window.__streetDebug?.cellStream?.();
        return state?.center?.key === expectedKey &&
          state.loadedKeys.includes(expectedKey) && state.pendingCount === 0;
      }, { expectedKey: expectedCellKey }, { timeout: READY_TIMEOUT });
    } catch { /* return the last state so a failed crossing remains diagnosable */ }
    cellStreaming = await page.evaluate(({ startKey, expectedKey }) => {
      const state = window.__streetDebug?.cellStream?.();
      const endKey = state?.center?.key || null;
      const crossed = !!endKey && endKey !== startKey && endKey === expectedKey;
      const neighborLoaded = !!state?.loadedKeys?.includes(expectedKey);
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
        validated: crossed && neighborLoaded && settled && noFailedCells && resourceLimitOk,
      };
    }, { startKey: cellStreamStart, expectedKey: expectedCellKey });
  }

  const metrics = await page.evaluate(() => {
    const fpsChip = document.querySelector('.chip.fps');
    const fpsText = fpsChip?.textContent || '0 FPS';
    const fps = parseInt(fpsText, 10) || 0;
    return {
      fps,
      triangles: window.__streetTriangles ?? null,
      perf: window.__perfCounters ?? null,
      player: window.__streetDebug?.player ? {
        x: window.__streetDebug.player.x,
        z: window.__streetDebug.player.z,
      } : null,
      vehicleActive: window.__streetDebug?.vehicle?.active === true,
    };
  });
  const displacementMeters = metrics.player
    ? Math.hypot(metrics.player.x - playerStart.x, metrics.player.z - playerStart.z)
    : null;

  const samples = metrics.perf?.fpsSamples ?? [];
  const frameIntervalsMs = orderedFrameIntervals(metrics.perf);
  const frameSummary = summarizeFrameIntervals(frameIntervalsMs);
  const rendererFrames = orderedRendererFrames(metrics.perf);
  const gpuFrameTimesMs = orderedGpuFrameTimes(metrics.perf);
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
    frameIntervalsMs,
    rendererFrameSummary: summarizeRendererFrames(rendererFrames),
    rendererFrames,
    gpuFrameSummary: summarizeDurationSamples(gpuFrameTimesMs),
    gpuFrameTimesMs,
    gpuTimer: metrics.perf?.gpuTimer || null,
    marks: metrics.perf?.marks || {},
    timings: orderedPerfTimeline(metrics.perf),
    metadata: metrics.perf?.metadata || {},
    settings: metrics.perf?.settings || {},
    resourceCounts: metrics.perf?.resourceCounts || {},
    unavailableMeasurements: metrics.perf?.unavailableMeasurements || [],
    validationErrors: metrics.perf?.validationErrors || [],
    environment: await page.evaluate(() => {
      const counters = window.__perfCounters;
      return {
        ...(counters?.environment || {}),
        visibilityState: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      };
    }),
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
  console.log(`  Route: ${route}; preset: ${qualityPreset}; renderer: ${rendererMode}; walk: ${walkDurationMs}ms${crossCell ? '; crossing a cell boundary' : ''}`);
  console.log('  City cache pre-warm skipped — benchmark fixture mode');
  const cache = { ok: true, ms: 0, skipped: true };

  const browser = await chromium.launch({
    headless: !headed,
    args: rendererMode === 'software' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
  });
  const context = await browser.newContext();
  await context.addInitScript(({ fixture, schemaVersion, preset, seed }) => {
    if (location.origin !== 'null') {
      try {
        const saved = JSON.parse(localStorage.getItem('wtw-game') || '{}');
        saved.state = {
          ...(saved.state || {}),
          settings: {
            ...(saved.state?.settings || {}),
            quality: preset,
            qualityMode: 'manual',
          },
        };
        localStorage.setItem('wtw-game', JSON.stringify(saved));
      } catch { /* the benchmark still records the active runtime preset */ }
    }
    window.__BENCH_MODE = true;
    window.__BENCH_SEED = seed;
    window.__BENCH_FIXTURE = fixture;
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
      timeline: [],
      timelineCursor: 0,
      marks: {},
      metadata: {},
      validationErrors: [],
    };
  }, { fixture: BENCH_FIXTURE, schemaVersion: PERF_SCHEMA_VERSION, preset: qualityPreset, seed });
  const page = await context.newPage();
  const browserDiagnostics = { consoleErrors: [], pageErrors: [], assetFailures: [] };
  const baseOrigin = new URL(baseUrl).origin;
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
      rendererMode,
      headless: !headed,
    },
    scenario: {
      fixture: fixtureOption,
      route,
      latitude: location.lat,
      longitude: location.lon,
      qualityPreset,
      walkDurationMs,
      seed,
      driving,
      crossCell,
    },
    cityCacheWarm: cache,
    street: null,
    globe: null,
    error: null,
  };

  try {
    console.log('  Street engine…');
    result.street = await benchStreet(page);
    if (screenshotPath) {
      mkdirSync(dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, animations: 'disabled' });
      console.log(`    screenshot: ${screenshotPath}`);
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
