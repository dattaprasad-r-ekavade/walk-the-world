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
  orderedRendererFrames,
  PERF_SCHEMA_VERSION,
  summarizeDurationSamples,
  summarizeFrameIntervals,
  summarizeRendererFrames,
  validateBenchmarkMeasurement,
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
const fixtureOption = option('--fixture', join('benchmarks', 'fixtures', 'rome-minimal.json'));
const fixturePath = isAbsolute(fixtureOption) ? fixtureOption : resolve(ROOT, fixtureOption);
const route = option('--route', '/street');
const qualityPreset = option('--preset', 'medium');
const rendererMode = option('--renderer-mode', 'software');
const browserChannel = option('--browser-channel', 'bundled');
const walkDurationMs = Number(option('--walk-ms', '12000'));
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
if (!Number.isFinite(walkDurationMs) || walkDurationMs < 1000) throw new Error('--walk-ms must be at least 1000');
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('--seed must be an integer from 0 to 4294967295');
if (!Number.isFinite(location.lat) || Math.abs(location.lat) > 90 || !Number.isFinite(location.lon) || Math.abs(location.lon) > 180) {
  throw new Error('Benchmark latitude/longitude are invalid');
}
if (!route.startsWith('/')) throw new Error('--route must be an absolute path such as /street');
const READY_TIMEOUT = 180_000;
const HOST_TELEMETRY_READY_MARKER = '__BENCH_HOST_TELEMETRY_READY__';

const BENCH_FIXTURE = JSON.parse(readFileSync(fixturePath, 'utf8'));

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
  const streetUrl = new URL(route, baseUrl);
  streetUrl.searchParams.set('lat', String(location.lat));
  streetUrl.searchParams.set('lon', String(location.lon));
  streetUrl.searchParams.set('bench', '1');
  await page.goto(streetUrl.toString(), {
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
  const hostTelemetryMonitor = startHostTelemetry(Math.min(600, Math.max(1, Math.ceil(walkDurationMs / 1000) + 3)));
  await hostTelemetryMonitor.ready;
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  await page.evaluate(() => {
    const counters = window.__perfCounters;
    if (counters) {
      counters.frameIntervalsMs.length = 0;
      counters.frameIntervalCursor = 0;
      counters.rendererFrames.length = 0;
      counters.rendererFrameCursor = 0;
      counters.gpuFrameTimesMs.length = 0;
      counters.gpuFrameTimeCursor = 0;
      counters.fpsSamples.length = 0;
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
  });
  const measurementStartedAt = new Date().toISOString();
  const measurementStartedMonotonicMs = performance.now();
  await page.keyboard.down('w');
  await page.waitForTimeout(walkDurationMs);
  await page.keyboard.up('w');
  const measurementEndedAt = new Date().toISOString();
  const wallElapsedMs = performance.now() - measurementStartedMonotonicMs;
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
      player: window.__streetDebug?.player ? {
        x: window.__streetDebug.player.x,
        z: window.__streetDebug.player.z,
      } : null,
      vehicleActive: window.__streetDebug?.vehicle?.active === true,
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
  const hostTelemetryPromise = hostTelemetryMonitor.finish();

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
  console.log(`  Route: ${route}; preset: ${qualityPreset}; browser: ${browserChannel}; renderer: ${rendererMode}; hour: ${benchmarkEnvironment.hour}; weather: ${benchmarkEnvironment.weather}; walk: ${walkDurationMs}ms${crossCell ? '; crossing a cell boundary' : ''}`);
  console.log('  City cache pre-warm skipped — benchmark fixture mode');
  const cache = { ok: true, ms: 0, skipped: true };

  const launchOptions = {
    headless: !headed,
    args: rendererMode === 'software' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
  };
  if (browserChannel === 'chrome') launchOptions.channel = 'chrome';
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext();
  await context.addInitScript(({ fixture, schemaVersion, preset, seed, pose, environment }) => {
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
      timeline: [],
      timelineCursor: 0,
      marks: {},
      metadata: {},
      validationErrors: [],
    };
  }, {
    fixture: BENCH_FIXTURE,
    schemaVersion: PERF_SCHEMA_VERSION,
    preset: qualityPreset,
    seed,
    pose: fixedPose,
    environment: benchmarkEnvironment,
  });
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
      driving,
      crossCell,
      fixedPose,
      populationFrozenUntilMeasurement: true,
      hostTelemetryEnabled: !skipHostTelemetry && process.platform === 'win32',
    },
    cityCacheWarm: cache,
    street: null,
    globe: null,
    error: null,
  };

  try {
    console.log('  Street engine…');
    result.street = await benchStreet(page);
    if (result.street.settings?.hour !== benchmarkEnvironment.hour || result.street.settings?.weather !== benchmarkEnvironment.weather) {
      throw new Error(`Applied scene environment did not match the requested benchmark: ${JSON.stringify(result.street.settings)}`);
    }
    result.hostTelemetry = result.street.hostTelemetry;
    if (screenshotPath) {
      mkdirSync(dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, animations: 'disabled' });
      console.log(`    screenshot: ${screenshotPath}`);
    }
    if (!result.street.measurementWindow?.valid) {
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
