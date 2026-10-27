#!/usr/bin/env node
/**
 * Performance benchmark for Walk the World refactor.
 * Usage: node scripts/bench-perf.mjs [--base-url http://127.0.0.1:3456] [--out benchmarks/before.json]
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { orderedFrameIntervals, orderedPerfTimeline, PERF_SCHEMA_VERSION, summarizeFrameIntervals } from '../lib/perf-summary.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

const args = process.argv.slice(2);
const baseUrl = args.includes('--base-url')
  ? args[args.indexOf('--base-url') + 1]
  : 'http://127.0.0.1:3456';
const outPath = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : join(ROOT, 'benchmarks', 'results.json');

const ROME = { lat: 41.8902, lon: 12.4922 };
const CITY_KEY = 'wtw_city6_41.890_12.492';
const WALK_MS = 12_000;
const READY_TIMEOUT = 180_000;

const BENCH_FIXTURE = JSON.parse(
  readFileSync(join(ROOT, 'benchmarks', 'fixtures', 'rome-minimal.json'), 'utf8')
);

async function prewarmCityCache() {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READY_TIMEOUT);
    const res = await fetch(`${baseUrl}/api/city/${CITY_KEY}`, { signal: ctrl.signal });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    return { ok: res.ok, ms, status: res.status };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e.message };
  }
}

async function benchStreet(page) {
  const t0 = Date.now();
  await page.goto(`${baseUrl}/street?lat=${ROME.lat}&lon=${ROME.lon}&bench=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(() => window.__engineReady === true, null, {
    timeout: READY_TIMEOUT,
  });
  const loadMs = Date.now() - t0;

  await page.click('.cesium-container', { timeout: 5000 }).catch(() => {});
  await page.keyboard.down('w');
  await page.evaluate(() => {
    const counters = window.__perfCounters;
    if (!counters) return;
    counters.frameIntervalsMs.length = 0;
    counters.frameIntervalCursor = 0;
    counters.fpsSamples.length = 0;
  });
  await page.waitForTimeout(WALK_MS);
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
    };
  });

  const samples = metrics.perf?.fpsSamples ?? [];
  const frameIntervalsMs = orderedFrameIntervals(metrics.perf);
  const avgFps =
    samples.length > 0
      ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
      : metrics.fps;

  return {
    loadMs,
    avgFps,
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
  await page.waitForTimeout(WALK_MS);
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

  console.log('  Pre-warming city cache… (skipped — bench fixture mode)');
  const cache = { ok: true, ms: 0, skipped: true };

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext();
  await context.addInitScript(({ fixture, schemaVersion }) => {
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
      marks: {},
      metadata: {},
      validationErrors: [],
    };
  }, { fixture: BENCH_FIXTURE, schemaVersion: PERF_SCHEMA_VERSION });
  const page = await context.newPage();

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
    browser: { name: 'Chromium', version: browser.version(), rendererMode: 'SwiftShader (software)' },
    walkDurationMs: WALK_MS,
    cityCacheWarm: cache,
    street: null,
    globe: null,
    error: null,
  };

  try {
    console.log('  Street engine…');
    result.street = await benchStreet(page);
    console.log(
      `    load: ${result.street.loadMs}ms, avg FPS: ${result.street.avgFps}, minimap draws: ${result.street.minimapDraws}`
    );

    console.log('  Globe page…');
    result.globe = await benchGlobe(page);
    console.log(
      `    status updates: ${result.globe.statusUpdates}, react renders: ${result.globe.reactRenders}, minimap draws: ${result.globe.minimapDraws}`
    );
  } catch (e) {
    result.error = e.message;
    console.error('Benchmark failed:', e.message);
  }

  await browser.close();
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Saved → ${outPath}`);
  if (result.error) process.exit(1);
}

main();
