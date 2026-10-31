#!/usr/bin/env node
// Reproducible S7 tour: Cesium globe to Tokyo, walk, night switch, then street
// travel to Edinburgh. Run visibly on the target laptop for release evidence.
// Headless mode validates the flow only; its timings are not hardware evidence.
//
//   node scripts/s7-tour.mjs --headed
//   node scripts/s7-tour.mjs --headed --quality=medium
//   node scripts/s7-tour.mjs --headless --out=benchmarks/results/stage0/s7-tour-control.json

import fs from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { recordedCityKeyForUrl, selectRecordedCityPayload } from "./bench-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE = "https://walk-the-world-delta.vercel.app";
const FRAME_LIMIT_MS = 500;

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE,
    out: null,
    screenshots: null,
    fixture: null,
    headed: false,
    targetI5Confirmed: false,
    cpuProfileCity: null,
    disableGpuProgramCache: false,
    qualityOverride: null,
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
    else if (arg === "--cpu-profile-arrival") options.cpuProfileCity = "Tokyo";
    else if (arg === "--cpu-profile-edinburgh") options.cpuProfileCity = "Edinburgh";
    else if (arg === "--disable-gpu-program-cache") options.disableGpuProgramCache = true;
    else if (arg === "--quality" || arg.startsWith("--quality=")) options.qualityOverride = value("--quality");
    else if (arg === "--base-url" || arg.startsWith("--base-url=")) options.baseUrl = value("--base-url");
    else if (arg === "--out" || arg.startsWith("--out=")) options.out = value("--out");
    else if (arg === "--screenshots" || arg.startsWith("--screenshots=")) options.screenshots = value("--screenshots");
    else if (arg === "--fixture" || arg.startsWith("--fixture=")) options.fixture = value("--fixture");
    else if (arg === "--ready-timeout-ms" || arg.startsWith("--ready-timeout-ms=")) options.readyTimeoutMs = Number(value("--ready-timeout-ms"));
    else if (arg === "--settle-timeout-ms" || arg.startsWith("--settle-timeout-ms=")) options.settleTimeoutMs = Number(value("--settle-timeout-ms"));
    else if (arg === "--walk-ms" || arg.startsWith("--walk-ms=")) options.walkMs = Number(value("--walk-ms"));
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else options.baseUrl = arg;
  }
  options.baseUrl = options.baseUrl.replace(/\/$/, "");
  if (options.qualityOverride && !["low", "medium", "high"].includes(options.qualityOverride)) {
    throw new Error("--quality must be low, medium, or high");
  }
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

function summarizeCpuProfile(profile, { pageStartMs = null, pageEndMs = null, longTasks = [] } = {}) {
  const nodes = profile?.nodes || [];
  const samples = profile?.samples || [];
  const timeDeltas = profile?.timeDeltas || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentById = new Map();
  for (const node of nodes) for (const childId of node.children || []) parentById.set(childId, node.id);
  const frameFor = (nodeId) => {
    const frame = byId.get(nodeId)?.callFrame || {};
    return {
      functionName: frame.functionName || "(anonymous)",
      url: frame.url || "",
      lineNumber: frame.lineNumber ?? null,
    };
  };
  const keyFor = (frame) => frame.functionName + "|" + frame.url + "|" + String(frame.lineNumber ?? -1);
  const callStackFor = (nodeId) => {
    const stack = [];
    let current = nodeId;
    while (current !== undefined && stack.length < 32) {
      if (byId.has(current)) stack.push(frameFor(current));
      current = parentById.get(current);
    }
    return stack.reverse();
  };
  const addSample = (map, nodeId, durationMs) => {
    if (durationMs <= 0) return;
    const frame = frameFor(nodeId);
    const callStack = callStackFor(nodeId);
    const key = callStack.map(keyFor).join(" <- ");
    const entry = map.get(key) || { ...frame, sampledSelfMs: 0, callStack };
    entry.sampledSelfMs += durationMs;
    map.set(key, entry);
  };
  const formatFrames = (map, count = 12) => [...map.values()]
    .sort((a, b) => b.sampledSelfMs - a.sampledSelfMs)
    .slice(0, count)
    .map(({ sampledSelfMs, callStack, ...frame }) => ({
      ...frame,
      sampledSelfMs: Math.round(sampledSelfMs * 10) / 10,
      callStack,
    }));
  const overall = new Map();
  const profileLongTasks = Number.isFinite(pageStartMs) && Number.isFinite(pageEndMs)
    ? longTasks.filter((task) => task.startTime < pageEndMs && task.startTime + task.duration > pageStartMs)
    : longTasks;
  const longestTask = profileLongTasks.reduce((longest, task) => task.duration > (longest?.duration || 0) ? task : longest, null);
  const inLongestTask = new Map();
  let elapsedMs = 0;
  let sampledWithinLongestTaskMs = 0;
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const deltaMs = (timeDeltas[i] || 0) / 1000;
    addSample(overall, nodeId, deltaMs);
    if (longestTask && Number.isFinite(pageStartMs)) {
      const sampleStartMs = pageStartMs + elapsedMs;
      const sampleEndMs = sampleStartMs + deltaMs;
      const taskStartMs = longestTask.startTime;
      const taskEndMs = taskStartMs + longestTask.duration;
      const overlapMs = Math.max(0, Math.min(sampleEndMs, taskEndMs) - Math.max(sampleStartMs, taskStartMs));
      if (overlapMs > 0) {
        addSample(inLongestTask, nodeId, overlapMs);
        sampledWithinLongestTaskMs += overlapMs;
      }
    }
    elapsedMs += deltaMs;
  }
  return {
    sampleCount: samples.length,
    sampledDurationMs: Math.round(elapsedMs * 10) / 10,
    topFrames: formatFrames(overall),
    longestLongTaskProfile: longestTask && Number.isFinite(pageStartMs) ? {
      startTimeMs: Math.round(longestTask.startTime * 10) / 10,
      durationMs: Math.round(longestTask.duration * 10) / 10,
      sampledMs: Math.round(sampledWithinLongestTaskMs * 10) / 10,
      topFrames: formatFrames(inLongestTask, 10),
    } : null,
  };
}
const profilerInit = () => {
  window.__perfCounters = { ...(window.__perfCounters || {}), diagnosticsEnabled: true };
  window.__s7LongTasks = [];
  window.__s7LongTasksSupported = false;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__s7LongTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
          attribution: [...(entry.attribution || [])].map((item) => ({
            containerType: item.containerType,
            containerName: item.containerName,
            containerId: item.containerId,
            name: item.name,
          })),
        });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    window.__s7LongTasksSupported = true;
  } catch { /* Long Task API is optional */ }
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
      const segment = {
        name,
        startedAt: performance.now(),
        last: null,
        intervals: [],
        maxFrameMs: 0,
        maxFrameStartMs: null,
        maxFrameEndMs: null,
        slowFrames: [],
      };
      this.active = segment;
      const tick = (at) => {
        if (this.active !== segment) return;
        if (segment.last !== null) {
          const duration = at - segment.last;
          segment.intervals.push(duration);
          if (duration > segment.maxFrameMs) {
            segment.maxFrameMs = duration;
            segment.maxFrameStartMs = segment.last;
            segment.maxFrameEndMs = at;
          }
          if (duration >= 100 && segment.slowFrames.length < 100) {
            segment.slowFrames.push({ startMs: segment.last, endMs: at, durationMs: duration });
          }
        }
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
        startedAtMs: Math.round(segment.startedAt * 10) / 10,
        endedAtMs: Math.round(performance.now() * 10) / 10,
        durationMs: Math.round((performance.now() - segment.startedAt) * 10) / 10,
        frameCount: values.length,
        p50Ms: Math.round((percentile(values, 0.5) ?? 0) * 10) / 10,
        p95Ms: Math.round((percentile(values, 0.95) ?? 0) * 10) / 10,
        maxFrameMs: values.length ? Math.round(segment.maxFrameMs * 10) / 10 : null,
        maxFrameStartMs: segment.maxFrameStartMs === null ? null : Math.round(segment.maxFrameStartMs * 10) / 10,
        maxFrameEndMs: segment.maxFrameEndMs === null ? null : Math.round(segment.maxFrameEndMs * 10) / 10,
        slowFrames: segment.slowFrames.map((frame) => ({
          startMs: Math.round(frame.startMs * 10) / 10,
          endMs: Math.round(frame.endMs * 10) / 10,
          durationMs: Math.round(frame.durationMs * 10) / 10,
        })),
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
    console.log("Usage: node scripts/s7-tour.mjs [baseUrl] [--headed --confirm-target-i5-1035g1] [--headless] [--quality=low|medium|high] [--cpu-profile-arrival|--cpu-profile-edinburgh] [--disable-gpu-program-cache] [--fixture=FILE] [--out=FILE] [--screenshots=DIR] [--walk-ms=5000]");
    console.log("The target confirmation flag requires a visible Windows i5-1035G1 run; acceptance also checks the reported Intel UHD renderer. Headless timings are control-flow evidence only.");
    return 0;
  }

  const processors = cpus();
  const host = {
    platform: process.platform,
    cpuModel: processors[0]?.model || null,
    logicalProcessors: processors.length,
  };
  const targetCpuConfirmed = process.platform === "win32" && /i5-1035g1/i.test(host.cpuModel || "");
  if (options.targetI5Confirmed && !options.headed) {
    throw new Error("--confirm-target-i5-1035g1 requires --headed");
  }
  if (options.targetI5Confirmed && !targetCpuConfirmed) {
    throw new Error(`Target confirmation rejected: expected Windows i5-1035G1; detected ${host.platform} / ${host.cpuModel || "unknown CPU"}`);
  }

  const paths = outputPaths(options);
  const fixturePath = options.fixture
    ? (path.isAbsolute(options.fixture) ? options.fixture : path.resolve(ROOT, options.fixture))
    : null;
  const fixture = fixturePath ? JSON.parse(fs.readFileSync(fixturePath, "utf8")) : null;
  if (fixture && (!fixture || typeof fixture !== "object" || Array.isArray(fixture) ||
      (!Array.isArray(fixture.elements) && !fixture.cellPayloads))) {
    throw new Error("--fixture must contain a city payload or a cellPayloads map");
  }
  fs.mkdirSync(path.dirname(paths.report), { recursive: true });
  fs.mkdirSync(paths.screenshots, { recursive: true });
  const { chromium } = await import("playwright");
  const browserArgs = options.disableGpuProgramCache ? ["--disable-gpu-program-cache"] : [];
  let browser;
  if (options.headed) {
    try {
      browser = await chromium.launch({ headless: false, channel: "chrome", args: browserArgs });
    } catch (error) {
      console.warn(`Installed Chrome unavailable (${error.message}); using Playwright Chromium visibly.`);
      browser = await chromium.launch({ headless: false, args: browserArgs });
    }
  } else {
    try {
      browser = await chromium.launch({ headless: true, args: browserArgs });
    } catch (error) {
      try { browser = await chromium.launch({ headless: true, channel: "chrome", args: browserArgs }); }
      catch { throw new Error(`No Chromium browser is installed for Playwright. Run 'npx playwright install chromium'. Original error: ${error.message}`); }
    }
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const fixtureRequests = [];
  const baseOrigin = new URL(options.baseUrl).origin;
  if (fixture) {
    await context.route((url) => recordedCityKeyForUrl(url, baseOrigin) !== null, async (route) => {
      const cityKey = recordedCityKeyForUrl(route.request().url(), baseOrigin);
      const payload = selectRecordedCityPayload(fixture, cityKey);
      fixtureRequests.push({ cityKey, elements: payload.elements?.length || 0 });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    await context.route((url) => url.origin === baseOrigin && url.pathname === "/api/assets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    );
  }
  if (options.qualityOverride) {
    await context.addInitScript((quality) => {
      const key = "wtw-game";
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        const persisted = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        const state = persisted.state && typeof persisted.state === "object" ? persisted.state : {};
        const settings = state.settings && typeof state.settings === "object" ? state.settings : {};
        localStorage.setItem(key, JSON.stringify({
          ...persisted,
          state: {
            ...state,
            settings: {
              hour: 12,
              weather: 0,
              quality: "medium",
              qualityMode: "auto",
              engine: "street",
              groundSource: "osm",
              music: true,
              developerMode: false,
              ...settings,
              quality,
              qualityMode: "manual",
            },
          },
        }));
      } catch { /* Storage may be unavailable on an originless bootstrap document. */ }
    }, options.qualityOverride);
  }
  await context.addInitScript(profilerInit);
  const page = await context.newPage();
  let cpuProfilerSession = null;
  let cpuProfileActive = false;
  const cpuProfiles = new Map();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  const requestFailures = [];
  const cellResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() });
  });
  page.on("pageerror", (error) => pageErrors.push(String(error?.stack || error?.message || error)));
  page.on("requestfailed", (request) => requestFailures.push({
    url: request.url(),
    resourceType: request.resourceType(),
    error: request.failure()?.errorText || "request failed",
  }));
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
    qualityOverride: options.qualityOverride,
    host,
    browserLaunchArgs: browserArgs,
    targetDeviceConfirmed: false,
    evidenceNote: options.headed
      ? "Visible browser timings describe this host. Confirm the reported adapter is Intel UHD on the i5-1035G1 before using this as target-device evidence."
      : "Headless timings are not hardware evidence; this run checks the tour flow only.",
    thresholds: { maxFrameMs: FRAME_LIMIT_MS, consoleErrors: 0, httpResponsesAtOrAbove400: 0 },
    segments: {},
    streetReadiness: {},
    screenshots: {},
    errors: { console: consoleErrors, page: pageErrors, http: httpErrors, requestFailures },
    cellResponses,
    fixtureReplay: fixturePath ? { path: fixturePath, requests: fixtureRequests } : null,
    status: "running",
    stallAnalysis: {},
    diagnosticProfiling: {
      requested: options.cpuProfileCity !== null,
      city: options.cpuProfileCity,
      status: options.cpuProfileCity ? "pending" : "disabled",
      samplingIntervalUs: options.cpuProfileCity ? 1000 : null,
    },
  };

  const startSegment = async (name) => page.evaluate((label) => window.__s7Profiler.start(label), name);
  const stopSegment = async () => page.evaluate(() => window.__s7Profiler.stop());
  const ensureCpuProfiler = async () => {
    if (!options.cpuProfileCity) return;
    try {
      cpuProfilerSession = await context.newCDPSession(page);
      await cpuProfilerSession.send("Profiler.enable");
      await cpuProfilerSession.send("Profiler.setSamplingInterval", { interval: 1000 });
      report.diagnosticProfiling.status = "ready";
    } catch (error) {
      report.diagnosticProfiling.status = "unavailable";
      report.diagnosticProfiling.error = String(error?.message || error);
      try { await cpuProfilerSession?.detach(); } catch { /* optional diagnostic cleanup */ }
      cpuProfilerSession = null;
    }
  };
  const startCpuProfile = async (segmentName) => {
    if (!cpuProfilerSession || report.diagnosticProfiling.status !== "ready") return;
    try {
      const startedAtPageMs = await page.evaluate(() => performance.now());
      await cpuProfilerSession.send("Profiler.start");
      cpuProfileActive = true;
      report.diagnosticProfiling.status = "recording";
      report.diagnosticProfiling.segment = segmentName;
      report.diagnosticProfiling.startedAtPageMs = startedAtPageMs;
    } catch (error) {
      report.diagnosticProfiling.status = "start-failed";
      report.diagnosticProfiling.error = String(error?.message || error);
    }
  };
  const stopCpuProfile = async (segmentName) => {
    if (!cpuProfilerSession || !cpuProfileActive) return;
    try {
      const { profile } = await cpuProfilerSession.send("Profiler.stop");
      cpuProfileActive = false;
      const endedAtPageMs = await page.evaluate(() => performance.now());
      const longTasks = await page.evaluate(() => window.__s7LongTasks || []);
      const summary = summarizeCpuProfile(profile, {
        pageStartMs: report.diagnosticProfiling.startedAtPageMs,
        pageEndMs: endedAtPageMs,
        longTasks,
      });
      cpuProfiles.set(segmentName, summary);
      report.diagnosticProfiling.status = "captured";
      report.diagnosticProfiling.endedAtPageMs = endedAtPageMs;
      report.diagnosticProfiling.sampleCount = summary.sampleCount;
      report.diagnosticProfiling.sampledDurationMs = summary.sampledDurationMs;
    } catch (error) {
      report.diagnosticProfiling.status = "stop-failed";
      report.diagnosticProfiling.error = String(error?.message || error);
    } finally {
      cpuProfileActive = false;
    }
  };
  const stopAndAnalyzeSegment = async (name) => {
    const segment = await stopSegment();
    report.segments[name] = segment;
    report.stallAnalysis[name] = await page.evaluate(({ startMs, endMs }) => {
      const perfTimeline = window.__perfCounters?.timeline || [];
      return {
        longTaskApiSupported: window.__s7LongTasksSupported === true,
        longTasks: (window.__s7LongTasks || []).filter((task) =>
          task.startTime < endMs && task.startTime + task.duration > startMs),
        perfEvents: perfTimeline.filter((event) => {
          if (!Number.isFinite(event.atMs) || event.atMs < startMs || event.atMs > endMs) return false;
          const name = String(event.name || "");
          if (event.type === "mark") return true;
          return /pmrem|renderer\.long-frame-programs/i.test(name) || (
            Number.isFinite(event.durationMs) && event.durationMs >= 50 &&
            /city\.(?:cell-load|worker-roundtrip|neighbor-assembly-total|neighbor-geometry-total|cell-shader-warmup|road-canvas-paint)|input-ready|engine-ready/i.test(name)
          );
        }),
      };
    }, { startMs: segment.startedAtMs, endMs: segment.endedAtMs });
    if (cpuProfiles.has(name)) report.stallAnalysis[name].cpuProfile = cpuProfiles.get(name);
    return segment;
  };
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
    const profileThisArrival = options.cpuProfileCity === city;
    await startSegment(segmentName);
    await placeButton.click();
    await page.waitForFunction((previousUrl) => location.href !== previousUrl,
      priorUrl, { timeout: 60000, polling: 50 });
    await stopAndAnalyzeSegment(segmentName);
    await startSegment(arrivalName);
    if (profileThisArrival) await startCpuProfile(arrivalName);
    await waitForStreetReady(priorReadyCount);
    if (profileThisArrival) await stopCpuProfile(arrivalName);
    await stopAndAnalyzeSegment(arrivalName);
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
    await stopAndAnalyzeSegment(settleName);
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
    await ensureCpuProfiler();
    await page.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: "Free explore the globe" }).waitFor({ state: "visible", timeout: 45000 });
    await startSegment("globeStartup");
    await page.getByRole("button", { name: "Free explore the globe" }).click();
    await page.locator('button[title="Fast travel (M)"]').first().waitFor({ state: "visible", timeout: options.readyTimeoutMs });
    await stopAndAnalyzeSegment("globeStartup");
    await saveShot("globe-ready");

    await travelTo("Tokyo", "globeTravelToTokyo", "tokyoArrival");

    const beforeWalk = await page.evaluate(() => ({ x: window.__streetDebug.player.x, z: window.__streetDebug.player.z }));
    await startSegment("walk");
    await page.keyboard.down("w");
    await page.waitForTimeout(options.walkMs);
    await page.keyboard.up("w");
    await stopAndAnalyzeSegment("walk");
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
    await stopAndAnalyzeSegment("nightSwitch");
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
        qualityTier: window.__perfCounters?.metadata?.qualityTier || null,
        renderScale: window.__perfCounters?.metadata?.renderScale ?? null,
        pixelRatio: window.__perfCounters?.metadata?.pixelRatio ?? null,
        engineReady: window.__engineReady === true,
        inputReadyMarks: timeline.filter((item) => item.type === "mark" && item.name === "input-ready").length,
        pmremTimings: timeline.filter((item) => item.type === "timing" && /pmrem/i.test(item.name)),
        webglCanvasCount: document.querySelectorAll("canvas").length,
      };
    });
    report.cellResponses = cellResponses;
    report.errors = { console: consoleErrors, page: pageErrors, http: httpErrors, requestFailures };
    const measuredSegments = ["walk", "nightSwitch", "globeTravelToTokyo", "streetTravelToEdinburgh"];
    report.acceptance = {
      measuredSegments,
      frameLimitPassed: measuredSegments.every((name) => report.segments[name]?.maxFrameMs !== null &&
        report.segments[name]?.maxFrameMs <= FRAME_LIMIT_MS),
      noConsoleErrors: consoleErrors.length === 0 && pageErrors.length === 0,
      noHttpErrors: httpErrors.length === 0,
      walkMoved: report.walk.displacementMeters !== null && report.walk.displacementMeters > 0.25,
      targetAdapterConfirmed: /Intel.*UHD|UHD.*Graphics/i.test(report.runtime.renderer || ""),
      targetCpuConfirmed,
      targetDeviceConfirmed: options.targetI5Confirmed && targetCpuConfirmed,
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
    if (cpuProfileActive) await stopCpuProfile(report.diagnosticProfiling.segment || "arrival");
    if (cpuProfilerSession) {
      try { await cpuProfilerSession.send("Profiler.disable"); } catch { /* optional diagnostic cleanup */ }
      try { await cpuProfilerSession.detach(); } catch { /* optional diagnostic cleanup */ }
    }
    report.finishedAt = new Date().toISOString();
    report.errors = { console: consoleErrors, page: pageErrors, http: httpErrors, requestFailures };
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
