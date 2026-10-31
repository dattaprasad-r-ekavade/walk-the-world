#!/usr/bin/env node
/**
 * Matched raw/prebuilt Tokyo comparison. Each repetition measures a fresh-
 * context cold visit, then a second visit in the same context to exercise
 * IndexedDB and HTTP cache reuse. A fixed post-settle window samples steady
 * frame and GPU timing. Use --headed --browser-channel=chrome for visible
 * hardware runs; reports include the actual WebGL renderer.
 *
 * Build with NEXT_PUBLIC_R2_PUBLIC_BASE=http://127.0.0.1:3457 and select
 * NEXT_PUBLIC_PREBUILT_CELL_BASE=/prebuilt-cells/no-cells (raw) or /prebuilt-cells.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { DEMO_PLACES } from "../lib/geo.js";
import { cityCacheKey } from "../lib/city-contract.js";
import {
  summarizeDurationSamples,
  summarizeFrameIntervals,
  summarizeRendererFrames,
} from "../lib/perf-summary.mjs";

const DEFAULT_BASE = "http://localhost:3456";
const DEFAULT_SNAPSHOT = path.join(process.env.TEMP || process.env.TMPDIR || ".", "walk-the-world-a7-r2-snapshot-2026-10-28");
const DEFAULT_OUT = "benchmarks/results/stage8/b1-matched-2026-10-29";

function parseArgs(argv) {
  const args = { mode: "", base: DEFAULT_BASE, snapshotDir: DEFAULT_SNAPSHOT, out: DEFAULT_OUT,
    city: "Tokyo", repetitions: 3, proxyPort: 3457, readyTimeoutMs: 90000, settleTimeoutMs: 45000,
    steadyWindowMs: 5000, headed: false, browserChannel: "bundled" };
  for (const value of argv) {
    if (value.startsWith("--mode=")) args.mode = value.slice(7).trim();
    else if (value.startsWith("--base-url=")) args.base = value.slice(11).trim();
    else if (value.startsWith("--snapshot-dir=")) args.snapshotDir = value.slice(15).trim();
    else if (value.startsWith("--out=")) args.out = value.slice(6).trim();
    else if (value.startsWith("--city=")) args.city = value.slice(7).trim();
    else if (value.startsWith("--repetitions=")) args.repetitions = Number.parseInt(value.slice(14), 10);
    else if (value.startsWith("--proxy-port=")) args.proxyPort = Number.parseInt(value.slice(13), 10);
    else if (value.startsWith("--ready-timeout-ms=")) args.readyTimeoutMs = Number.parseInt(value.slice(19), 10);
    else if (value.startsWith("--settle-timeout-ms=")) args.settleTimeoutMs = Number.parseInt(value.slice(20), 10);
    else if (value.startsWith("--steady-window-ms=")) args.steadyWindowMs = Number.parseInt(value.slice(19), 10);
    else if (value.startsWith("--browser-channel=")) args.browserChannel = value.slice(18).trim();
    else if (value === "--headed") args.headed = true;
    else if (value === "--help" || value === "-h") args.help = true;
  }
  if (args.help) return args;
  if (!["raw", "prebuilt"].includes(args.mode)) throw new Error("--mode must be raw or prebuilt");
  if (!Number.isInteger(args.repetitions) || args.repetitions < 1 || args.repetitions > 10) {
    throw new Error("--repetitions must be an integer from 1 to 10");
  }
  if (!Number.isInteger(args.proxyPort) || args.proxyPort < 1 || args.proxyPort > 65535) {
    throw new Error("--proxy-port must be a valid TCP port");
  }
  if (!Number.isInteger(args.steadyWindowMs) || args.steadyWindowMs < 0 || args.steadyWindowMs > 30000) {
    throw new Error("--steady-window-ms must be an integer from 0 to 30000");
  }
  if (!["bundled", "chrome"].includes(args.browserChannel)) {
    throw new Error("--browser-channel must be bundled or chrome");
  }
  if (!path.isAbsolute(args.snapshotDir)) args.snapshotDir = path.resolve(args.snapshotDir);
  if (!path.isAbsolute(args.out)) args.out = path.resolve(args.out);
  args.base = args.base.replace(/\/$/u, "");
  return args;
}

function startSnapshotProxy(snapshotDir, port) {
  const accesses = [];
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`).pathname;
    const key = path.basename(pathname).replace(/\.json$/u, "");
    const file = path.join(snapshotDir, `${key}.json`);
    if (!/^wtw_city\d+_-?\d+\.\d+_-?\d+\.\d+$/u.test(key) || !fs.existsSync(file)) {
      accesses.push({ key, status: 404, bytes: 0 });
      response.writeHead(404, corsHeaders({ "content-length": "0" }));
      response.end();
      return;
    }
    const body = fs.readFileSync(file);
    accesses.push({ key, status: 200, bytes: body.byteLength });
    response.writeHead(200, corsHeaders({
      "content-type": "application/json",
      "content-length": String(body.byteLength),
      "cache-control": "no-store",
    }));
    response.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve({ server, accesses }));
  });
}

function corsHeaders(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "*",
    "timing-allow-origin": "*",
    ...extra,
  };
}

function relevantUrl(value) {
  try {
    const url = new URL(value);
    return /\/prebuilt-cells\/|\/no-prebuilt-cells\//u.test(url.pathname) ||
      (/wtw_city\d+_-?\d+\.\d+_-?\d+\.\d+\.json$/u.test(url.pathname));
  } catch { return false; }
}

async function waitForReadyAndSettle(page, args) {
  await page.goto(`${args.base}/street?lat=${place.lat}&lon=${place.lon}&demo=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  let ready = false;
  let readyMs = null;
  let readySnapshot = null;
  try {
    await page.waitForFunction(() => window.__engineReady === true, null, { timeout: args.readyTimeoutMs, polling: 250 });
    ready = true;
    readyMs = await page.evaluate(() => Math.round(performance.now()));
    readySnapshot = await captureVisitState(page);
  } catch { /* retained as a failed visit in the report */ }
  let settled = false;
  let settledSnapshot = null;
  if (ready) {
    try {
      await page.waitForFunction(() => {
        const state = window.__streetDebug?.cellStream?.();
        if (!state || state.pendingCount !== 0) return false;
        return state.loadedKeys.length + state.failedKeys.length + state.deferredKeys.length >= 9;
      }, null, { timeout: args.settleTimeoutMs, polling: 250 });
      settled = true;
      settledSnapshot = await captureVisitState(page);
    } catch { /* retained as a failed visit in the report */ }
  }
  return { ready, readyMs, settled, readySnapshot, settledSnapshot };
}

async function captureVisitState(page) {
  return page.evaluate(() => {
    const stream = window.__streetDebug?.cellStream?.() || {};
    const perf = window.__perfCounters || {};
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => {
        try {
          return /\/prebuilt-cells\/|\/no-prebuilt-cells\/|wtw_city\d+_-?\d+\.\d+_-?\d+\.\d+\.json$/u.test(new URL(entry.name).pathname);
        } catch { return false; }
      })
      .map((entry) => ({
        name: new URL(entry.name).pathname,
        durationMs: +entry.duration.toFixed(1),
        transferSize: Number.isFinite(entry.transferSize) ? entry.transferSize : null,
        encodedBodySize: Number.isFinite(entry.encodedBodySize) ? entry.encodedBodySize : null,
        decodedBodySize: Number.isFinite(entry.decodedBodySize) ? entry.decodedBodySize : null,
      }));
    const timeline = Array.isArray(perf.timeline) ? perf.timeline : [];
    const steadyWindowStartAtMs = Number.isFinite(window.__BENCH_STEADY_WINDOW_START_AT)
      ? window.__BENCH_STEADY_WINDOW_START_AT : null;
    const timings = timeline.filter((event) => event.type === "timing" && /^(?:city\.(?:initial-data-consumer|cell-load|indexeddb-read|fetch-to-headers|json-body-and-parse|enrichment|consumer-copy|spawn-clip|spawn-geometry-total|spawn-assembly-total|prebuilt-terrain-revision|prebuilt-terrain-tiles|prebuilt-terrain-hash(?:-(?:pack|digest))?|prebuilt-frame-rebase|prebuilt-shader-warmup)|terrain\.height-(?:source|image-decode|pixels|grid|grid-resolve))$/u.test(event.name))
      .filter((event) => steadyWindowStartAtMs === null || event.atMs >= steadyWindowStartAtMs)
      .map(({ name, durationMs, details }) => ({ name, durationMs: +durationMs.toFixed(1), details }));
    const steadyWindow = window.__BENCH_STEADY_WINDOW || null;
    return {
      capturedAtMs: Math.round(performance.now()),
      steadyWindow: steadyWindow ? {
        ...steadyWindow,
        endedAtMs: Math.round(performance.now()),
        actualDurationMs: Math.round(performance.now() - steadyWindow.startedAtMs),
      } : null,
      browserEnvironment: {
        userAgent: navigator.userAgent,
        platform: navigator.platform || null,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGb: navigator.deviceMemory || null,
        visibilityState: document.visibilityState,
        pageHasFocus: document.hasFocus(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
      },
      environment: perf.environment || {},
      settings: perf.settings || {},
      resourceCounts: perf.resourceCounts || {},
      gpuTimer: perf.gpuTimer || null,
      cellStream: {
        loadedKeys: stream.loadedKeys || [],
        failedKeys: stream.failedKeys || [],
        deferredKeys: stream.deferredKeys || [],
        residentCellCount: stream.residentCellCount ?? null,
        pendingCount: stream.pendingCount ?? null,
      },
      originCacheTier: perf.marks?.["city-cache-hit"]?.details?.tier || null,
      marks: perf.marks || {},
      timings,
      resources,
      diagnostics: {
        diagnosticsEnabled: perf.diagnosticsEnabled === true,
        frameIntervalsMs: Array.isArray(perf.frameIntervalsMs) ? [...perf.frameIntervalsMs] : [],
        rendererFrames: Array.isArray(perf.rendererFrames) ? [...perf.rendererFrames] : [],
        gpuFrameTimesMs: Array.isArray(perf.gpuFrameTimesMs) ? [...perf.gpuFrameTimesMs] : [],
        frameIntervalCursor: perf.frameIntervalCursor || 0,
        rendererFrameCursor: perf.rendererFrameCursor || 0,
        gpuFrameTimeCursor: perf.gpuFrameTimeCursor || 0,
      },
    };
  });
}

async function measureSteadyWindow(page, windowMs) {
  // Let pre-window GPU timer queries drain before clearing the ring buffers.
  await page.waitForTimeout(250);
  await page.evaluate((requestedDurationMs) => {
    const counters = window.__perfCounters;
    if (counters) {
      counters.frameIntervalsMs = [];
      counters.frameIntervalCursor = 0;
      counters.rendererFrames = [];
      counters.rendererFrameCursor = 0;
      counters.gpuFrameTimesMs = [];
      counters.gpuFrameTimeCursor = 0;
    }
    const startedAtMs = performance.now();
    window.__BENCH_STEADY_WINDOW_START_AT = startedAtMs;
    window.__BENCH_STEADY_WINDOW = { startedAtMs: Math.round(startedAtMs), requestedDurationMs };
  }, windowMs);
  await page.waitForTimeout(windowMs);
  return captureVisitState(page);
}

function summarizeVisitState(snapshot) {
  if (!snapshot) return null;
  const diagnostics = snapshot.diagnostics || {};
  const frameIntervals = diagnostics.frameIntervalsMs || [];
  const rendererFrames = diagnostics.rendererFrames || [];
  const gpuFrameTimes = diagnostics.gpuFrameTimesMs || [];
  return {
    capturedAtMs: snapshot.capturedAtMs,
    steadyWindow: snapshot.steadyWindow || null,
    browserEnvironment: snapshot.browserEnvironment,
    webgl: snapshot.environment?.webgl || null,
    settings: snapshot.settings,
    resourceCounts: snapshot.resourceCounts,
    gpuTimer: snapshot.gpuTimer,
    cellStream: snapshot.cellStream,
    originCacheTier: snapshot.originCacheTier,
    marks: snapshot.marks,
    timings: snapshot.timings,
    resources: snapshot.resources,
    diagnostics: {
      enabled: diagnostics.diagnosticsEnabled === true,
      frameIntervals: summarizeFrameIntervals(frameIntervals),
      rendererFrames: summarizeRendererFrames(rendererFrames),
      gpuFrameTimes: summarizeDurationSamples(gpuFrameTimes),
      samples: {
        frameIntervalsMs: frameIntervals,
        rendererFrames,
        gpuFrameTimesMs: gpuFrameTimes,
      },
      cursors: {
        frameIntervals: diagnostics.frameIntervalCursor || 0,
        rendererFrames: diagnostics.rendererFrameCursor || 0,
        gpuFrameTimes: diagnostics.gpuFrameTimeCursor || 0,
      },
    },
  };
}

let place;
async function measureVisit(context, args, repetition, cacheMode, screenshotPath = null) {
  console.log(`  ${args.mode} repetition ${repetition} ${cacheMode}: navigating`);
  const page = await context.newPage();
  const errors = [];
  const responses = [];
  const pendingBodies = [];
  const startedAt = Date.now();
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error.message || error)));
  page.on("response", (response) => {
    if (!relevantUrl(response.url())) return;
    const record = { url: response.url(), status: response.status(), bytes: null, durationMs: null };
    const requestStart = response.request().timing()?.startTime;
    const requestEnd = response.request().timing()?.responseEnd;
    if (Number.isFinite(requestStart) && Number.isFinite(requestEnd) && requestEnd >= requestStart) {
      record.durationMs = +((requestEnd - requestStart).toFixed(1));
    }
    responses.push(record);
    pendingBodies.push(response.body().then((body) => { record.bytes = body.byteLength; }).catch(() => {}));
  });
  let outcome = { ready: false, readyMs: null, settled: false };
  let steadySnapshot = null;
  let note = "";
  try {
    outcome = await waitForReadyAndSettle(page, args);
    console.log(`  ${args.mode} repetition ${repetition} ${cacheMode}: ready=${outcome.ready} settled=${outcome.settled} readyMs=${outcome.readyMs}`);
    if (!outcome.ready) note = `engine did not become ready within ${args.readyTimeoutMs} ms`;
    if (outcome.ready && !outcome.settled) note = `cell stream did not settle within ${args.settleTimeoutMs} ms`;
    if (screenshotPath && outcome.ready) await page.screenshot({ path: screenshotPath, type: "png" });
    if (outcome.settled && args.steadyWindowMs > 0) {
      steadySnapshot = await measureSteadyWindow(page, args.steadyWindowMs);
      console.log(`  ${args.mode} repetition ${repetition} ${cacheMode}: steady window ${steadySnapshot.steadyWindow?.actualDurationMs ?? "unknown"} ms`);
    }
  } catch (error) {
    note = String(error?.message || error).split("\n")[0];
  }
  const state = outcome.settledSnapshot || outcome.readySnapshot;
  const readyState = summarizeVisitState(outcome.readySnapshot);
  const settledState = summarizeVisitState(outcome.settledSnapshot);
  await Promise.race([
    Promise.all(pendingBodies),
    new Promise((resolve) => setTimeout(resolve, 15000)),
  ]);
  const rawResponses = responses.filter((item) => /wtw_city\d+_-?\d+\.\d+_-?\d+\.\d+\.json$/u.test(new URL(item.url).pathname));
  const prebuiltResponses = responses.filter((item) => /\.wtwc\.gz$/u.test(new URL(item.url).pathname));
  const indexResponses = responses.filter((item) => /(?:\/prebuilt-cells\/(?:no-cells\/)?|\/no-prebuilt-cells\/)index\.json$/u.test(new URL(item.url).pathname));
  const originRawRequested = rawResponses.some((item) => item.url.endsWith(`/${originKey}.json`));
  const artifactResponse = prebuiltResponses.find((item) => item.status === 200) || null;
  const resources = state?.resources || [];
  const networkTransferBytes = resources.reduce((sum, item) => sum + (item.transferSize || 0), 0);
  const payloadBytes = rawResponses.reduce((sum, item) => sum + (item.bytes || 0), 0) +
    prebuiltResponses.reduce((sum, item) => sum + (item.bytes || 0), 0);
  await page.close();
  return {
    repetition,
    cacheMode,
    screenshot: screenshotPath ? path.relative(process.cwd(), screenshotPath) : null,
    ready: outcome.ready,
    readyMs: outcome.readyMs,
    settled: outcome.settled,
    elapsedMs: Date.now() - startedAt,
    originKey,
    originRawRequested,
    rawCellResponseCount: rawResponses.length,
    rawCellPayloadBytes: rawResponses.reduce((sum, item) => sum + (item.bytes || 0), 0),
    prebuiltIndexResponses: indexResponses.map(({ url, status }) => ({ url, status })),
    prebuiltArtifactResponses: prebuiltResponses.map(({ url, status, bytes }) => ({ url, status, bytes })),
    prebuiltArtifactPayloadBytes: prebuiltResponses.reduce((sum, item) => sum + (item.bytes || 0), 0),
    relevantNetworkTransferBytes: networkTransferBytes,
    relevantPayloadBytes: payloadBytes,
    originCacheTier: state?.originCacheTier ?? null,
    cellStream: state?.cellStream || null,
    timings: state?.timings || [],
    resources,
    renderer: state?.environment?.webgl || null,
    browserEnvironment: state?.browserEnvironment || null,
    readyMetrics: readyState,
    settledMetrics: settledState,
    steadyWindowMs: args.steadyWindowMs,
    steadyMetrics: summarizeVisitState(steadySnapshot),
    diagnosticsEnabled: state?.diagnostics?.enabled ?? false,
    errors,
    note,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node scripts/bench-prebuilt-cells.mjs --mode=raw|prebuilt [--base-url=URL] [--snapshot-dir=DIR] [--out=DIR] [--repetitions=3] [--steady-window-ms=5000] [--headed] [--browser-channel=bundled|chrome]");
    return 0;
  }
  if (!fs.existsSync(args.snapshotDir)) throw new Error(`Snapshot directory does not exist: ${args.snapshotDir}`);
  place = DEMO_PLACES.find((item) => item.name.toLowerCase() === args.city.toLowerCase());
  if (!place) throw new Error(`Unknown city "${args.city}"`);
  originKey = cityCacheKey(place.lat, place.lon);
  fs.mkdirSync(args.out, { recursive: true });
  const { server: proxy, accesses } = await startSnapshotProxy(args.snapshotDir, args.proxyPort);
  let browser;
  let launchedBrowserChannel = args.browserChannel;
  try {
    const launchOptions = { headless: !args.headed };
    if (args.browserChannel === "chrome") launchOptions.channel = "chrome";
    try { browser = await chromium.launch(launchOptions); }
    catch (error) {
      if (args.browserChannel === "chrome") {
        throw new Error("Failed to launch the requested Chrome channel", { cause: error });
      }
      browser = await chromium.launch({ headless: !args.headed, channel: "chrome" });
      launchedBrowserChannel = "chrome-fallback";
    }
    const report = {
      mode: args.mode,
      city: place.name,
      coordinates: { lat: place.lat, lon: place.lon },
      originKey,
      base: args.base,
      proxyBase: `http://127.0.0.1:${args.proxyPort}`,
      snapshotDir: path.basename(args.snapshotDir),
      browser: {
        name: "Chromium",
        version: browser.version(),
        requestedChannel: args.browserChannel,
        launchedChannel: launchedBrowserChannel,
        headed: args.headed,
        headless: !args.headed,
        serviceWorkers: "blocked",
        requestRouting: false,
        httpCache: "enabled",
      },
      repetitions: args.repetitions,
      steadyWindowMs: args.steadyWindowMs,
      coldWarmProtocol: "Each repetition uses a fresh browser context. Cold visit loads first; warm visit opens a new page in the same context after cold has settled. A fixed steady window starts after the stream settles and a 250 ms GPU-query drain.",
      at: new Date().toISOString(),
      runs: [],
    };
    for (let repetition = 1; repetition <= args.repetitions; repetition++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
      await context.addInitScript(() => { window.__perfCounters = { diagnosticsEnabled: true }; });
      const prefix = `${args.city.toLowerCase()}-${args.mode}-${String(repetition).padStart(2, "0")}`;
      const cold = await measureVisit(context, args, repetition, "cold", path.join(args.out, `${prefix}-cold.png`));
      const warm = await measureVisit(context, args, repetition, "warm");
      report.runs.push({ cold, warm });
      await context.close();
      fs.writeFileSync(path.join(args.out, "report.json"), JSON.stringify(report, null, 2));
      console.log(`${args.mode} ${repetition}/${args.repetitions}: cold ${cold.readyMs} ms; warm ${warm.readyMs} ms; raw ${cold.rawCellPayloadBytes} B; prebuilt ${cold.prebuiltArtifactPayloadBytes} B`);
    }
    report.snapshotProxyAccesses = accesses;
    report.summary = {
      coldReadyMs: report.runs.map((run) => run.cold.readyMs),
      warmReadyMs: report.runs.map((run) => run.warm.readyMs),
      coldRawPayloadBytes: report.runs.map((run) => run.cold.rawCellPayloadBytes),
      coldPrebuiltPayloadBytes: report.runs.map((run) => run.cold.prebuiltArtifactPayloadBytes),
      coldAllReady: report.runs.every((run) => run.cold.ready && run.cold.settled),
      warmAllReady: report.runs.every((run) => run.warm.ready && run.warm.settled),
      coldNoDeferredCells: report.runs.every((run) => (run.cold.cellStream?.deferredKeys || []).length === 0),
      warmNoDeferredCells: report.runs.every((run) => (run.warm.cellStream?.deferredKeys || []).length === 0),
      coldHasExpectedModeEvidence: report.runs.every((run) => args.mode === "raw"
        ? run.cold.originRawRequested && run.cold.prebuiltArtifactResponses.length === 0
        : !run.cold.originRawRequested && run.cold.prebuiltArtifactResponses.some((response) => response.status === 200)),
      warmHasExpectedModeEvidence: report.runs.every((run) => args.mode === "raw"
        ? !run.warm.originRawRequested && run.warm.originCacheTier === "indexeddb"
        : !run.warm.originRawRequested && run.warm.prebuiltArtifactResponses.some((response) => response.status === 200)),
      steadyWindowsComplete: args.steadyWindowMs === 0 || report.runs.every((run) => [run.cold, run.warm].every((visit) =>
        visit.steadyMetrics?.steadyWindow?.actualDurationMs >= args.steadyWindowMs)),
      steadyColdFrameP95Ms: report.runs.map((run) => run.cold.steadyMetrics?.diagnostics?.frameIntervals?.p95FrameTimeMs ?? null),
      steadyWarmFrameP95Ms: report.runs.map((run) => run.warm.steadyMetrics?.diagnostics?.frameIntervals?.p95FrameTimeMs ?? null),
      steadyColdGpuP95Ms: report.runs.map((run) => run.cold.steadyMetrics?.diagnostics?.gpuFrameTimes?.p95Ms ?? null),
      steadyWarmGpuP95Ms: report.runs.map((run) => run.warm.steadyMetrics?.diagnostics?.gpuFrameTimes?.p95Ms ?? null),
      steadyGpuTimerSupported: args.steadyWindowMs === 0 || report.runs.every((run) => [run.cold, run.warm].every((visit) =>
        visit.steadyMetrics?.gpuTimer?.supported === true)),
      steadyFrameSamplesPresent: args.steadyWindowMs === 0 || report.runs.every((run) => [run.cold, run.warm].every((visit) =>
        (visit.steadyMetrics?.diagnostics?.frameIntervals?.sampleCount || 0) > 0)),
      steadyGpuSamplesPresent: args.steadyWindowMs === 0 || report.runs.every((run) => [run.cold, run.warm].every((visit) =>
        (visit.steadyMetrics?.diagnostics?.gpuFrameTimes?.sampleCount || 0) > 0)),
      steadyVisibleAndFocused: !args.headed || report.runs.every((run) => [run.cold, run.warm].every((visit) =>
        visit.steadyMetrics?.browserEnvironment?.visibilityState === "visible" &&
        visit.steadyMetrics?.browserEnvironment?.pageHasFocus === true)),
    };
    fs.writeFileSync(path.join(args.out, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.summary, null, 2));
    return report.summary.coldAllReady && report.summary.warmAllReady &&
      report.summary.coldNoDeferredCells && report.summary.warmNoDeferredCells &&
      report.summary.coldHasExpectedModeEvidence && report.summary.warmHasExpectedModeEvidence &&
      report.summary.steadyWindowsComplete && report.summary.steadyGpuTimerSupported &&
      report.summary.steadyFrameSamplesPresent && report.summary.steadyGpuSamplesPresent &&
      report.summary.steadyVisibleAndFocused ? 0 : 1;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => proxy.close(resolve));
  }
}

let originKey;
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(1); });
}
