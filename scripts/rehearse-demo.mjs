// Demo rehearsal: checks R2 cell warmth for each DEMO_PLACES entry, then loads each
// in a real browser and records readiness, console errors, a screenshot and frame times.
//
//   node scripts/rehearse-demo.mjs [baseUrl] [--headed] [--r2-node-proxy] [--diagnostics] [--frames=300]
//     [--out=screenshots/demo-track/rehearsal] [--help]
//
// Headless timings are not hardware evidence.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEMO_PLACES } from "../lib/geo.js";
import { cityCacheKey, cellNeighborhood } from "../lib/city-contract.js";

const DEFAULT_BASE = "https://walk-the-world-delta.vercel.app";
const DEFAULT_OUT = "screenshots/demo-track/rehearsal";

export function percentile(values, p) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[idx];
}

export function isNoiseError(text) {
  return /CORS|Access-Control-Allow-Origin|net::ERR_FAILED/i.test(String(text || ""));
}

export function filterConsoleErrors(messages) {
  return (messages || []).filter((m) => !isNoiseError(m));
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function formatTable(rows, columns) {
  const cell = (v) => (v === null || v === undefined ? "-" : String(v));
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (cells) => cells.map((s, i) => s.padEnd(widths[i])).join("  ").trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(columns.map((c) => cell(r[c]))))].join("\n");
}

export function parseArgs(argv) {
  const out = { base: DEFAULT_BASE, headed: false, out: DEFAULT_OUT, help: false, r2NodeProxy: false, diagnostics: false,
    frames: 300, city: null, readyTimeoutMs: 90000, settleTimeoutMs: 45000, r2SnapshotDir: null };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--headed") out.headed = true;
    else if (a === "--r2-node-proxy") out.r2NodeProxy = true;
    else if (a === "--diagnostics") out.diagnostics = true;
    else if (a.startsWith("--city=")) out.city = a.slice(7).trim();
    else if (a.startsWith("--r2-snapshot-dir=")) out.r2SnapshotDir = a.slice("--r2-snapshot-dir=".length).trim();
    else if (a.startsWith("--ready-timeout-ms=")) {
      const ms = Number.parseInt(a.slice(19), 10);
      if (Number.isInteger(ms) && ms > 0) out.readyTimeoutMs = Math.min(ms, 300000);
    }
    else if (a.startsWith("--settle-timeout-ms=")) {
      const ms = Number.parseInt(a.slice(20), 10);
      if (Number.isInteger(ms) && ms > 0) out.settleTimeoutMs = Math.min(ms, 180000);
    }
    else if (a.startsWith("--frames=")) {
      const frames = Number.parseInt(a.slice(9), 10);
      if (Number.isInteger(frames) && frames > 0) out.frames = Math.min(frames, 10000);
    }
    else if (a.startsWith("--out=")) out.out = a.slice(6);
    else if (!a.startsWith("--")) out.base = a;
  }
  out.base = out.base.replace(/\/$/, "");
  return out;
}

async function fetchCell(key, r2, snapshotDir) {
  const file = snapshotDir ? path.join(snapshotDir, `${key}.json`) : null;
  if (file && fs.existsSync(file)) return { status: 200, body: fs.readFileSync(file), contentType: "application/json" };
  const response = await fetch(`${r2}/${key}.json?v=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "application/json";
  if (response.ok && file) {
    fs.mkdirSync(snapshotDir, { recursive: true });
    fs.writeFileSync(file, body);
  }
  return { status: response.status, body, contentType };
}

async function checkCells(place, r2, snapshotDir) {
  const keys = cellNeighborhood(place.lat, place.lon).map(([la, lo]) => cityCacheKey(la, lo));
  const missing = [];
  await Promise.all(keys.map(async (key) => {
    try {
      const response = await fetchCell(key, r2, snapshotDir);
      if (response.status !== 200 || !response.body.length) missing.push(key);
    } catch { missing.push(key); }
  }));
  return { total: keys.length, warm: keys.length - missing.length, missing };
}

async function rehearsePlace(browser, base, place, outDir, { r2, r2NodeProxy, r2SnapshotDir, frames, readyTimeoutMs, settleTimeoutMs, diagnostics }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" });
  if (diagnostics) {
    await ctx.addInitScript(() => {
      window.__perfCounters = { ...(window.__perfCounters || {}), diagnosticsEnabled: true };
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  const cellResponses = [];
  const cellFailures = [];
  const nodeProxyFailures = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("requestfailed", (request) => {
    if (/\/wtw_city[^/]*\.json(?:\?|$)/.test(request.url())) {
      cellFailures.push({ url: request.url(), error: request.failure()?.errorText || "request failed" });
    }
  });
  page.on("response", (response) => {
    if (/\/wtw_city[^/]*\.json(?:\?|$)/.test(response.url())) {
      cellResponses.push({ status: response.status(), url: response.url() });
    }
  });
  const res = { ready: false, settled: false, readyMs: null, consoleErrors: 0, cellResponses, cellFailures, nodeProxyFailures,
    p50: null, p95: null, spawn: null, shot: null, note: "" };
  try {
    if (r2NodeProxy) {
      const r2Origin = new URL(r2).origin;
      await ctx.route((url) => url.origin === r2Origin && /\/wtw_city[^/]*\.json$/u.test(url.pathname), async (route) => {
        try {
          const key = path.basename(new URL(route.request().url()).pathname).replace(/\.json$/u, "");
          const upstream = await fetchCell(key, r2, r2SnapshotDir);
          await route.fulfill({
            status: upstream.status,
            body: upstream.body,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET, HEAD, OPTIONS",
              "access-control-allow-headers": "*",
              "cache-control": "no-store",
              "content-type": upstream.contentType,
            },
          });
        } catch (error) {
          const message = String(error?.message || error);
          nodeProxyFailures.push({ url: route.request().url(), error: message });
          errors.push(`Node-side R2 fetch failed: ${message}`);
          await route.abort();
        }
      });
    }
    const url = `${base}/street?lat=${place.lat}&lon=${place.lon}&demo=1`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    try {
      await page.waitForFunction(() => window.__engineReady === true, null, { timeout: readyTimeoutMs, polling: 250 });
      res.ready = true;
      res.readyMs = Math.round(await page.evaluate(() => performance.now()));
    } catch { res.note = `not ready within ${readyTimeoutMs} ms`; }
    await page.waitForTimeout(4000);
    try {
      await page.waitForFunction(() => {
        const state = window.__streetDebug?.cellStream?.();
        if (!state || state.pendingCount !== 0) return false;
        const resolved = state.loadedKeys.length + state.failedKeys.length + state.deferredKeys.length;
        return resolved >= 9;
      }, null, { timeout: settleTimeoutMs, polling: 250 });
      res.settled = true;
    } catch { /* keep the capture and report the unsettled stream below */ }
    res.spawn = await page.evaluate((expectedHeadingDeg) => {
      const debug = window.__streetDebug;
      const player = debug?.player;
      const framing = debug?.spawnFraming?.() || null;
      const heading = Number.isFinite(player?.heading) ? player.heading : null;
      const headingDegrees = heading === null ? null : ((Math.round(heading * 180 / Math.PI) % 360) + 360) % 360;
      return {
        framing,
        headingRadians: heading,
        headingDegrees,
        pitchRadians: Number.isFinite(player?.pitch) ? player.pitch : null,
        thirdPerson: player?.third === true,
        expectedHeadingDeg,
        headingMatchesPreset: expectedHeadingDeg === null ||
          (headingDegrees === expectedHeadingDeg && framing?.headingSource === "demo-preset"),
        localPosition: player && Number.isFinite(player.x) && Number.isFinite(player.z)
          ? { x: +player.x.toFixed(1), z: +player.z.toFixed(1) }
          : null,
        cellStream: debug?.cellStream?.() || null,
        shaderProgramCount: debug?.shaderProgramCount?.() ?? null,
      };
    }, Number.isFinite(place.preset?.headingDeg) ? place.preset.headingDeg : null);
    const shot = path.join(outDir, `${slugify(place.name)}.jpg`);
    await page.screenshot({ path: shot, type: "jpeg", quality: 80 });
    res.shot = shot;
    const intervals = await page.evaluate((frameCount) => new Promise((resolve) => {
      const out = []; let last = performance.now();
      const tick = (t) => { out.push(t - last); last = t; out.length < frameCount ? requestAnimationFrame(tick) : resolve(out); };
      requestAnimationFrame(tick);
    }), frames);
    res.p50 = +percentile(intervals, 50).toFixed(1);
    res.p95 = +percentile(intervals, 95).toFixed(1);
    const sceneStats = await page.evaluate(() => {
      const meshes = window.__streetDebug?.meshes?.() || [];
      return {
        meshCount: meshes.length,
        triangleCount: meshes.reduce((sum, mesh) => sum + (Number.isFinite(mesh.tris) ? mesh.tris : 0), 0),
      };
    });
    Object.assign(res.spawn, sceneStats);
    res.landusePaint = await page.evaluate(() => {
      if (window.__perfCounters?.diagnosticsEnabled !== true) return null;
      const events = (window.__perfCounters?.timeline || []).filter((event) =>
        event.type === "timing" && event.name === "city.road-canvas-paint"
      );
      return {
        batches: events.length,
        rings: events.reduce((sum, event) => sum + (Number(event.details?.landuseRings) || 0), 0),
        paintedTiles: events.reduce((sum, event) => sum + (Number(event.details?.landusePaintedTiles) || 0), 0),
      };
    });
  } catch (e) { res.note = String(e.message || e).split("\n")[0]; }
  res.errors = filterConsoleErrors(errors);
  res.consoleErrors = res.errors.length;
  await ctx.close();
  return res;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node scripts/rehearse-demo.mjs [baseUrl] [--headed] [--r2-node-proxy] [--r2-snapshot-dir=DIR] [--city=NAME] [--frames=300] [--out=DIR] [--diagnostics] [--help]\n" +
      `  baseUrl        default ${DEFAULT_BASE}\n  --out          default ${DEFAULT_OUT}\n` +
      "  --r2-node-proxy fetches public city cells from Node and adds CORS for local previews\n" +
      "  --r2-snapshot-dir records/replays city-cell bodies for matched A/B captures\n" +
      "  --city         rehearse one demo city (Pune, Edinburgh, Tokyo, or New York)\n" +
      "  --diagnostics  enables browser perf counters; timings are diagnostic only\n" +
      "  --ready-timeout-ms   time allowed for engine readiness (default 90000)\n" +
      "  --settle-timeout-ms  time allowed for cell stream to settle (default 45000)\n" +
      `  --frames       animation-frame samples per city (default 300)\nHeadless timings are not hardware evidence.`);
    return 0;
  }
  const r2 = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE || "https://myjyotishai.in").replace(/\/$/, "");
  const places = args.city
    ? DEMO_PLACES.filter((place) => place.name.toLowerCase() === args.city.toLowerCase())
    : DEMO_PLACES;
  if (!places.length) throw new Error(`Unknown demo city "${args.city}". Choose one of: ${DEMO_PLACES.map((place) => place.name).join(", ")}`);
  fs.mkdirSync(args.out, { recursive: true });
  console.log(`Base ${args.base}  R2 ${r2}\n`);

  const report = { base: args.base, r2, r2NodeProxy: args.r2NodeProxy, r2SnapshotDir: args.r2SnapshotDir,
    diagnostics: args.diagnostics,
    frameSamples: args.frames,
    headed: args.headed, at: new Date().toISOString(), places: [] };
  for (const p of places) report.places.push({ name: p.name, preset: p.preset, cells: await checkCells(p, r2, args.r2SnapshotDir) });
  const reportPath = path.join(args.out, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: !args.headed, ...(args.headed ? { channel: "chrome" } : {}) });
  } catch (e) {
    console.log("Bundled chromium unavailable, falling back to installed Chrome channel.");
    browser = await chromium.launch({ headless: !args.headed, channel: "chrome" });
  }
  try {
    for (let i = 0; i < places.length; i++) {
      report.places[i].browser = await rehearsePlace(browser, args.base, places[i], args.out, { ...args, r2 });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }
  } finally { await browser.close(); }

  const rows = report.places.map((r) => ({
    city: r.name,
    cells: `${r.cells.warm}/${r.cells.total}`,
    ready: r.browser.ready ? "yes" : "NO",
    settled: r.browser.settled ? "yes" : "NO",
    resident: r.browser.spawn?.cellStream?.residentCellCount ?? null,
    failed: r.browser.spawn?.cellStream?.failedKeys?.length ?? null,
    readyMs: r.browser.readyMs,
    errors: r.browser.consoleErrors,
    "heading°": r.browser.spawn?.headingDegrees,
    headingMatch: r.browser.spawn?.headingMatchesPreset ? "yes" : "NO",
    landuseRings: r.browser.landusePaint?.rings ?? null,
    paintedTiles: r.browser.landusePaint?.paintedTiles ?? null,
    "p50ms": r.browser.p50,
    "p95ms": r.browser.p95,
  }));
  console.log(formatTable(rows, ["city", "cells", "ready", "settled", "resident", "failed", "readyMs", "errors", "heading°", "headingMatch", "landuseRings", "paintedTiles", "p50ms", "p95ms"]));
  for (const r of report.places) if (r.cells.missing.length) console.log(`\nMissing (${r.name}):\n  ${r.cells.missing.join("\n  ")}`);
  console.log(args.diagnostics
    ? "\nBrowser diagnostics enabled; frame timings are diagnostic only."
    : args.headed
      ? "\nVisible Chrome run; timings represent this host."
    : "\nNote: headless timings are not hardware evidence.");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const bad = report.places.some((r) =>
    r.cells.missing.length || !r.browser.ready || !r.browser.settled || r.browser.spawn?.headingMatchesPreset === false
  );
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
