#!/usr/bin/env node
// Reproducible S7 tour: Cesium globe to Tokyo, walk, night switch, then street
// travel to Edinburgh. Run visibly on the target laptop for release evidence.
// Headless mode validates the flow only; its timings are not hardware evidence.
//
//   node scripts/s7-tour.mjs --headed
//   node scripts/s7-tour.mjs --headless --out=benchmarks/results/stage0/s7-tour-control.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE = "https://walk-the-world-delta.vercel.app";
const FRAME_LIMIT_MS = 500;

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE,
    out: null,
    screenshots: null,
    headed: false,
    targetI5Confirmed: false,
    help: false,
    readyTimeoutMs: 120000,
    settleTimeoutMs: 45000,
    walkMs: 5000,
    segmentTailMs: 1000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (name) => {
      const equalValue = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
      const nextValue = equalValue ?? argv[++i];
      if (!nextValue || nextValue.startsWith("--")) throw new Error(`Expected a value after ${name}`);
      return nextValue;
    };
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--headed") options.headed = true;
    else if (arg === "--headless") options.headed = false;
    else if (arg === "--confirm-target-i5-1035g1") options.targetI5Confirmed = true;
    else if (arg === "--base-url" || arg.startsWith("--base-url=")) options.baseUrl = value("--base-url");
    else if (arg === "--out" || arg.startsWith("--out=")) options.out = value("--out");
    else if (arg === "--screenshots" || arg.startsWith("--screenshots=")) options.screenshots = value("--screenshots");
    else if (arg === "--ready-timeout-ms" || arg.startsWith("--ready-timeout-ms=")) options.readyTimeoutMs = Number(value("--ready-timeout-ms"));
    else if (arg === "--settle-timeout-ms" || arg.startsWith("--settle-timeout-ms=")) options.settleTimeoutMs = Number(value("--settle-timeout-ms"));
    else if (arg === "--walk-ms" || arg.startsWith("--walk-ms=")) options.walkMs = Number(value("--walk-ms"));
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else options.baseUrl = arg;
  }
  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  if (!Number.isFinite(options.readyTimeoutMs) || options.readyTimeoutMs < 1000) throw new Error("--ready-timeout-ms must be at least 1000");
  if (!Number.isFinite(options.walkMs) || options.walkMs < 1000) throw new Error("--walk-ms must be at least 1000");
  return options;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

function outputPaths(options) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = options.out || path.join("benchmarks", "results", "stage0", `s7-tour-${stamp}.json`);
  const screenshots = options.screenshots || path.join("screenshots", "performance-visuals", "stage0", `s7-tour-${stamp}`);
  return {
    report: path.isAbsolute(report) ? report : path.resolve(ROOT, report),
    screenshots: path.isAbsolute(screenshots) ? screenshots : path.resolve(ROOT, screenshots),
  };
}

const profilerInit = () => {
  window.__perfCounters = { ...(window.__perfCounters || {}), diagnosticsEnabled: true };
  const readinessKey = "__s7InputReadyCount";
  window.__s7CountedReadyMarks = 0;
  const readReadyCount = () => {
    try { return Number(sessionStorage.getItem(readinessKey) || 0); }
    catch { return 0; }
  };
  window.__s7ReadyCount = readReadyCount;
  window.setInterval(() => {
    const count = (window.__perfCounters?.timeline || []).filter((item) => item.type === "mark" && item.name === "input-ready").length;
    if (count <= window.__s7CountedReadyMarks) return;
    try {
      const total = readReadyCount() + count - window.__s7CountedReadyMarks;
      sessionStorage.setItem(readinessKey, String(total));
      window.__s7CountedReadyMarks = count;
    } catch { /* session storage may be unavailable on opaque pages */ }
  }, 25);
  window.__s7Profiler = {
    active: null,
    start(name) {
      const segment = { name, startedAt: performance.now(), last: null, intervals: [] };
      this.active = segment;
      const tick = (at) => {
        if (this.active !== segment) return;
        if (segment.last !== null) segment.intervals.push(at - segment.last);
        segment.last = at;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stop() {
      const segment = this.active;
      this.active = null;
      if (!segment) return null;
      const values = segment.intervals.filter(Number.isFinite);
      return {
        name: segment.name,
        durationMs: Math.round((performance.now() - segment.startedAt) * 10) / 10,
        frameCount: values.length,
        p50Ms: Math.round((percentile(values, 0.5) ?? 0) * 10) / 10,
        p95Ms: Math.round((percentile(values, 0.95) ?? 0) * 10) / 10,
        maxFrameMs: values.length ? Math.round(values.reduce((max, value) => Math.max(max, value), 0) * 10) / 10 : null,
        framesOver500Ms: values.filter((value) => value > 500).length,
      };
    },
  };
  function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(values.length * fraction) - 1)];
  }
};

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log("Usage: node scripts/s7-tour.mjs [baseUrl] [--headed --confirm-target-i5-1035g1] [--headless] [--out=FILE] [--screenshots=DIR] [--walk-ms=5000]");
    console.log("Run visibly on the target i5-1035G1 laptop and confirm the target device explicitly. Headless timings are control-flow evidence only.");
    return 0;
  }

  const paths = outputPaths(options);
  fs.mkdirSync(path.dirname(paths.report), { recursive: true });
  fs.mkdirSync(paths.screenshots, { recursive: true });
  const { chromium } = await import("playwright");
  let browser;
  if (options.headed) {
    try {
      browser = await chromium.launch({ headless: false, channel: "chrome" });
    } catch (error) {
      console.warn(`Installed Chrome unavailable (${error.message}); using Playwright Chromium visibly.`);
      browser = await chromium.launch({ headless: false });
    }
  } else {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      try { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
      catch { throw new Error(`No Chromium browser is installed for Playwright. Run 'npx playwright install chromium'. Original error: ${error.message}`); }
    }
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  await context.addInitScript(profilerInit);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  const cellResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() });
  });
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error?.message || error)));
  page.on("response", (response) => {
    const record = { status: response.status(), url: response.url(), resourceType: response.request().resourceType() };
    if (record.status >= 400) httpErrors.push(record);
    if (/\/wtw_city[^/]*\.json(?:\?|$)/.test(record.url)) cellResponses.push(record);
  });

  const report = {
    schemaVersion: 1,
    baseUrl: options.baseUrl,
    startedAt: new Date().toISOString(),
    runMode: options.headed ? "visible" : "headless-control-flow-only",
    targetDeviceConfirmed: false,
    evidenceNote: options.headed
      ? "Visible browser timings describe this host. Confirm the reported adapter is Intel UHD on the i5-1035G1 before using this as target-device evidence."
      : "Headless timings are not hardware evidence; this run checks the tour flow only.",
    thresholds: { maxFrameMs: FRAME_LIMIT_MS, consoleErrors: 0, httpResponsesAtOrAbove400: 0 },
    segments: {},
    streetReadiness: {},
    screenshots: {},
    errors: { console: consoleErrors, page: pageErrors, http: httpErrors },
    cellResponses,
    status: "running",
  };

  const startSegment = async (name) => page.evaluate((label) => window.__s7Profiler.start(label), name);
  const stopSegment = async () => page.evaluate(() => window.__s7Profiler.stop());
  const saveShot = async (name) => {
    const target = path.join(paths.screenshots, `${name}.jpg`);
    await page.screenshot({ path: target, type: "jpeg", quality: 85, fullPage: false });
    report.screenshots[name] = path.relative(ROOT, target).replaceAll("\\", "/");
  };
  const inputReadyCount = async () => page.evaluate(() =>
    window.__s7ReadyCount?.() ?? 0);
  const waitForStreetReady = async (priorReadyCount) => {
    await page.waitForFunction((previous) => (window.__s7ReadyCount?.() ?? 0) > previous,
    priorReadyCount, { timeout: options.readyTimeoutMs, polling: 100 });
    await page.waitForFunction(() => window.__engineReady === true && !!window.__streetDebug?.player,
      null, { timeout: options.readyTimeoutMs, polling: 100 });
    await page.waitForTimeout(options.segmentTailMs);
  };
  const travelTo = async (city, segmentName, arrivalName) => {
    await page.locator('button[title="Fast travel (M)"]').first().click();
    const placeButton = page.getByRole("button", { name: new RegExp(city, "i") }).last();
    await placeButton.waitFor({ state: "visible", timeout: 15000 });
    const priorReadyCount = await inputReadyCount();
    const priorUrl = await page.evaluate(() => location.href);
    await startSegment(segmentName);
    await placeButton.click();
    await page.waitForFunction((previousUrl) => location.href !== previousUrl,
      priorUrl, { timeout: 60000, polling: 50 });
    report.segments[segmentName] = await stopSegment();
    await startSegment(arrivalName);
    await waitForStreetReady(priorReadyCount);
    report.segments[arrivalName] = await stopSegment();
    const settleName = `${arrivalName}CellSettle`;
    await startSegment(settleName);
    let cellsSettled = false;
    try {
      await page.waitForFunction(() => {
        const state = window.__streetDebug?.cellStream?.();
        if (!state || state.pendingCount !== 0) return false;
        return state.loadedKeys.length + state.failedKeys.length + state.deferredKeys.length >= 9;
      }, null, { timeout: options.settleTimeoutMs, polling: 250 });
      cellsSettled = true;
    } catch { /* preserve readiness and diagnostics when neighbor cells stay pending */ }
    report.segments[settleName] = await stopSegment();
    report.streetReadiness[city] = await page.evaluate((settled) => {
      const timeline = window.__perfCounters?.timeline || [];
      const terrain = [...timeline].reverse().find((item) => item.type === "mark" && item.name === "terrain-ready");
      return {
        cellsSettled: settled,
        terrain: terrain?.details || null,
        cellStream: window.__streetDebug?.cellStream?.() || null,
      };
    }, cellsSettled);
    await saveShot(city.toLowerCase().replace(/\s+/g, "-") + "-arrival");
  };

  try {
    await page.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: "Free explore the globe" }).waitFor({ state: "visible", timeout: 45000 });
    await startSegment("globeStartup");
    await page.getByRole("button", { name: "Free explore the globe" }).click();
    await page.locator('button[title="Fast travel (M)"]').first().waitFor({ state: "visible", timeout: options.readyTimeoutMs });
    report.segments.globeStartup = await stopSegment();
    await saveShot("globe-ready");

    await travelTo("Tokyo", "globeTravelToTokyo", "tokyoArrival");

    const beforeWalk = await page.evaluate(() => ({ x: window.__streetDebug.player.x, z: window.__streetDebug.player.z }));
    await startSegment("walk");
    await page.keyboard.down("w");
    await page.waitForTimeout(options.walkMs);
    await page.keyboard.up("w");
    report.segments.walk = await stopSegment();
    report.walk = await page.evaluate((before) => {
      const player = window.__streetDebug?.player;
      const dx = Number.isFinite(player?.x) ? player.x - before.x : null;
      const dz = Number.isFinite(player?.z) ? player.z - before.z : null;
      return { start: before, end: player && { x: player.x, z: player.z }, displacementMeters: dx === null || dz === null ? null : Math.hypot(dx, dz) };
    }, beforeWalk);
    await saveShot("tokyo-walk");

    await startSegment("nightSwitch");
    await page.evaluate(() => window.__streetDebug.setTime(21));
    await page.waitForTimeout(2500);
    report.segments.nightSwitch = await stopSegment();
    await saveShot("tokyo-night");

    await travelTo("Edinburgh", "streetTravelToEdinburgh", "edinburghArrival");
    report.runtime = await page.evaluate(() => {
      const canvas = [...document.querySelectorAll("canvas")].find((item) => item.clientWidth > 0 && item.clientHeight > 0);
      let renderer = null;
      try {
        const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl") || canvas?.getContext("experimental-webgl");
        const debug = gl?.getExtension("WEBGL_debug_renderer_info");
        renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) || null;
      } catch { /* renderer identification is optional */ }
      const timeline = window.__perfCounters?.timeline || [];
      return {
        userAgent: navigator.userAgent,
        renderer,
        engineReady: window.__engineReady === true,
        inputReadyMarks: timeline.filter((item) => item.type === "mark" && item.name === "input-ready").length,
        pmremTimings: timeline.filter((item) => item.type === "timing" && /pmrem/i.test(item.name)),
        webglCanvasCount: document.querySelectorAll("canvas").length,
      };
    });
    report.cellResponses = cellResponses;
    report.errors = { console: consoleErrors, page: pageErrors, http: httpErrors };
    const measuredSegments = ["walk", "nightSwitch", "globeTravelToTokyo", "streetTravelToEdinburgh"];
    report.acceptance = {
      measuredSegments,
      frameLimitPassed: measuredSegments.every((name) => report.segments[name]?.maxFrameMs !== null &&
        report.segments[name]?.maxFrameMs <= FRAME_LIMIT_MS),
      noConsoleErrors: consoleErrors.length === 0 && pageErrors.length === 0,
      noHttpErrors: httpErrors.length === 0,
      walkMoved: report.walk.displacementMeters !== null && report.walk.displacementMeters > 0.25,
      targetAdapterConfirmed: /Intel.*UHD|UHD.*Graphics/i.test(report.runtime.renderer || ""),
      targetDeviceConfirmed: options.targetI5Confirmed,
      terrainVisualReviewRequired: true,
      performancePassed: false,
    };
    report.acceptance.performancePassed = report.acceptance.frameLimitPassed && report.acceptance.noConsoleErrors &&
      report.acceptance.noHttpErrors && report.acceptance.walkMoved && report.acceptance.targetAdapterConfirmed &&
      report.acceptance.targetDeviceConfirmed && options.headed;
    report.targetDeviceConfirmed = report.acceptance.targetDeviceConfirmed;
    report.status = report.acceptance.performancePassed
      ? "target-performance-passed-visual-review-required"
      : options.headed ? "visible-run-needs-review" : "control-flow-complete";
  } catch (error) {
    report.status = "incomplete";
    report.failure = String(error?.stack || error?.message || error);
    console.error(`S7 tour did not complete: ${error?.message || error}`);
  } finally {
    report.finishedAt = new Date().toISOString();
    report.errors = { console: consoleErrors, page: pageErrors, http: httpErrors };
    fs.writeFileSync(paths.report, JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
  }

  console.log(`S7 tour: ${report.status}`);
  console.log(`Report: ${path.relative(ROOT, paths.report).replaceAll("\\", "/")}`);
  if (report.runtime) console.log(`Renderer: ${report.runtime.renderer || "unavailable"}; errors: ${consoleErrors.length} console, ${pageErrors.length} page, ${httpErrors.length} HTTP`);
  for (const [name, segment] of Object.entries(report.segments)) {
    console.log(`  ${name}: max ${segment?.maxFrameMs ?? "n/a"} ms, p95 ${segment?.p95Ms ?? "n/a"} ms, ${segment?.frameCount ?? 0} frames`);
  }
  if (report.status === "incomplete") return 2;
  if (report.acceptance?.performancePassed) return 0;
  if (options.headed && report.acceptance && !report.acceptance.performancePassed) return 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error?.stack || error);
    process.exit(2);
  });
}
