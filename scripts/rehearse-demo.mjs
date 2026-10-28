// Demo rehearsal: checks R2 cell warmth for each DEMO_PLACES entry, then loads each
// in a real browser and records readiness, console errors, a screenshot and frame times.
//
//   node scripts/rehearse-demo.mjs [baseUrl] [--headed] [--r2-node-proxy] [--frames=300]
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
  const out = { base: DEFAULT_BASE, headed: false, out: DEFAULT_OUT, help: false, r2NodeProxy: false, frames: 300 };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--headed") out.headed = true;
    else if (a === "--r2-node-proxy") out.r2NodeProxy = true;
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

async function checkCells(place, r2) {
  const keys = cellNeighborhood(place.lat, place.lon).map(([la, lo]) => cityCacheKey(la, lo));
  const missing = [];
  await Promise.all(keys.map(async (key) => {
    try {
      const res = await fetch(`${r2}/${key}.json?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) missing.push(key);
      else await res.arrayBuffer();
    } catch { missing.push(key); }
  }));
  return { total: keys.length, warm: keys.length - missing.length, missing };
}

async function rehearsePlace(browser, base, place, outDir, { r2, r2NodeProxy, frames }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  const cellResponses = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("response", (response) => {
    if (/\/wtw_city[^/]*\.json(?:\?|$)/.test(response.url())) {
      cellResponses.push({ status: response.status(), url: new URL(response.url()).pathname });
    }
  });
  const res = { ready: false, settled: false, readyMs: null, consoleErrors: 0, cellResponses,
    p50: null, p95: null, spawn: null, shot: null, note: "" };
  try {
    if (r2NodeProxy) {
      await page.route(`${r2}/**`, async (route) => {
        try {
          const upstream = await fetch(route.request().url(), { cache: "no-store" });
          const body = Buffer.from(await upstream.arrayBuffer());
          const contentType = upstream.headers.get("content-type");
          await route.fulfill({
            status: upstream.status,
            body,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET, HEAD, OPTIONS",
              "access-control-allow-headers": "*",
              "cache-control": "no-store",
              ...(contentType ? { "content-type": contentType } : {}),
            },
          });
        } catch (error) {
          errors.push(`Node-side R2 fetch failed: ${error?.message || error}`);
          await route.abort();
        }
      });
    }
    const url = `${base}/street?lat=${place.lat}&lon=${place.lon}&demo=1`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    try {
      await page.waitForFunction(() => window.__engineReady === true, null, { timeout: 90000, polling: 250 });
      res.ready = true;
      res.readyMs = Math.round(await page.evaluate(() => performance.now()));
    } catch { res.note = "not ready in 90s"; }
    await page.waitForTimeout(4000);
    try {
      await page.waitForFunction(() => {
        const state = window.__streetDebug?.cellStream?.();
        return state?.residentCellCount >= 9 && state.pendingCount === 0;
      }, null, { timeout: 45000, polling: 250 });
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
  } catch (e) { res.note = String(e.message || e).split("\n")[0]; }
  res.consoleErrors = filterConsoleErrors(errors).length;
  await ctx.close();
  return res;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node scripts/rehearse-demo.mjs [baseUrl] [--headed] [--r2-node-proxy] [--frames=300] [--out=DIR] [--help]\n" +
      `  baseUrl        default ${DEFAULT_BASE}\n  --out          default ${DEFAULT_OUT}\n` +
      "  --r2-node-proxy fetches public city cells from Node and adds CORS for local previews\n" +
      `  --frames       animation-frame samples per city (default 300)\nHeadless timings are not hardware evidence.`);
    return 0;
  }
  const r2 = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE || "https://myjyotishai.in").replace(/\/$/, "");
  fs.mkdirSync(args.out, { recursive: true });
  console.log(`Base ${args.base}  R2 ${r2}\n`);

  const report = { base: args.base, r2, r2NodeProxy: args.r2NodeProxy, frameSamples: args.frames,
    headed: args.headed, at: new Date().toISOString(), places: [] };
  for (const p of DEMO_PLACES) report.places.push({ name: p.name, preset: p.preset, cells: await checkCells(p, r2) });

  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({ headless: !args.headed, ...(args.headed ? { channel: "chrome" } : {}) });
  } catch (e) {
    console.log("Bundled chromium unavailable, falling back to installed Chrome channel.");
    browser = await chromium.launch({ headless: !args.headed, channel: "chrome" });
  }
  try {
    for (let i = 0; i < DEMO_PLACES.length; i++) {
      report.places[i].browser = await rehearsePlace(browser, args.base, DEMO_PLACES[i], args.out, args);
    }
  } finally { await browser.close(); }

  const rows = report.places.map((r) => ({
    city: r.name,
    cells: `${r.cells.warm}/${r.cells.total}`,
    ready: r.browser.ready ? "yes" : "NO",
    settled: r.browser.settled ? "yes" : "NO",
    readyMs: r.browser.readyMs,
    errors: r.browser.consoleErrors,
    "heading°": r.browser.spawn?.headingDegrees,
    headingMatch: r.browser.spawn?.headingMatchesPreset ? "yes" : "NO",
    "p50ms": r.browser.p50,
    "p95ms": r.browser.p95,
  }));
  console.log(formatTable(rows, ["city", "cells", "ready", "settled", "readyMs", "errors", "heading°", "headingMatch", "p50ms", "p95ms"]));
  for (const r of report.places) if (r.cells.missing.length) console.log(`\nMissing (${r.name}):\n  ${r.cells.missing.join("\n  ")}`);
  console.log(args.headed
    ? "\nVisible Chrome run; timings represent this host."
    : "\nNote: headless timings are not hardware evidence.");
  fs.writeFileSync(path.join(args.out, "report.json"), JSON.stringify(report, null, 2));
  const bad = report.places.some((r) =>
    r.cells.missing.length || !r.browser.ready || !r.browser.settled || r.browser.spawn?.headingMatchesPreset === false
  );
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
}
