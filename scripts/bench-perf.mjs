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
import { orderedFrameIntervals, orderedPerfTimeline, PERF_SCHEMA_VERSION, summarizeFrameIntervals } from '../lib/perf-summary.mjs';

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
const fixtureOption = option('--fixture', join('benchmarks', 'fixtures', 'rome-minimal.json'));
const fixturePath = isAbsolute(fixtureOption) ? fixtureOption : resolve(ROOT, fixtureOption);
const route = option('--route', '/street');
const qualityPreset = option('--preset', 'medium');
const rendererMode = option('--renderer-mode', 'software');
const walkDurationMs = Number(option('--walk-ms', '12000'));
const location = {
  lat: Number(option('--lat', '41.8902')),
  lon: Number(option('--lon', '12.4922')),
};
const headed = args.includes('--headed');
const skipGlobe = args.includes('--skip-globe');
if (!['low', 'medium', 'high'].includes(qualityPreset)) throw new Error('--preset must be low, medium, or high');
if (!['software', 'browser-default'].includes(rendererMode)) throw new Error('--renderer-mode must be software or browser-default');
if (!Number.isFinite(walkDurationMs) || walkDurationMs < 1000) throw new Error('--walk-ms must be at least 1000');
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

  const playerStart = await page.evaluate(() => {
    const player = window.__streetDebug?.player;
    return player ? { x: player.x, z: player.z } : null;
  });
  if (!playerStart) throw new Error('Street player debug state is unavailable');
  await page.bringToFront();
  await page.evaluate(() => window.focus());
  await page.keyboard.down('w');
  await page.evaluate(() => {
    const counters = window.__perfCounters;
    if (!counters) return;
    counters.frameIntervalsMs.length = 0;
    counters.frameIntervalCursor = 0;
    counters.fpsSamples.length = 0;
  });
  await page.waitForTimeout(walkDurationMs);
  await page.keyboard.up('w');
  await page.waitForTimeout(500);

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
    };
  });
  const displacementMeters = metrics.player
    ? Math.hypot(metrics.player.x - playerStart.x, metrics.player.z - playerStart.z)
    : null;

  const samples = metrics.perf?.fpsSamples ?? [];
  const frameIntervalsMs = orderedFrameIntervals(metrics.perf);
  const avgFps =
    samples.length > 0
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
    preset: qualityPreset,
    fpsSamples: samples,
    frameSummary: summarizeFrameIntervals(frameIntervalsMs),
    frameIntervalsMs,
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
  console.log(`  Route: ${route}; preset: ${qualityPreset}; renderer: ${rendererMode}; walk: ${walkDurationMs}ms`);
  console.log('  City cache pre-warm skipped — benchmark fixture mode');
  const cache = { ok: true, ms: 0, skipped: true };

  const browser = await chromium.launch({
    headless: !headed,
    args: rendererMode === 'software' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [],
  });
  const context = await browser.newContext();
  await context.addInitScript(({ fixture, schemaVersion, preset }) => {
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
  }, { fixture: BENCH_FIXTURE, schemaVersion: PERF_SCHEMA_VERSION, preset: qualityPreset });
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
    },
    cityCacheWarm: cache,
    street: null,
    globe: null,
    error: null,
  };

  try {
    console.log('  Street engine…');
    result.street = await benchStreet(page);
    console.log(
      `    load: ${result.street.loadMs}ms, avg FPS: ${result.street.avgFps}, movement: ${result.street.movement.displacementMeters?.toFixed(2) ?? 'n/a'}m`
    );
    if (!result.street.movement.validated) throw new Error('Street movement did not exceed 0.25m; controls were not validated');

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
