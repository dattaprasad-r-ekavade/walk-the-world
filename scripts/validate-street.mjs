#!/usr/bin/env node
/** Quick street-engine geometry validation via Playwright */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const baseUrl = process.argv[2] || 'http://127.0.0.1:3456';
const fixture = JSON.parse(
  readFileSync(join(ROOT, 'benchmarks/fixtures/rome-minimal.json'), 'utf8')
);

const ROME = { lat: 41.8902, lon: 12.4922 };

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript((fx) => {
  window.__BENCH_MODE = true;
  window.__BENCH_FIXTURE = fx;
}, fixture);
await page.goto(`${baseUrl}/street?lat=${ROME.lat}&lon=${ROME.lon}&bench=1`, {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => window.__engineReady === true, null, { timeout: 180000 });
await page.waitForFunction(() => (window.__streetTriangles ?? 0) > 20, null, { timeout: 60000 });

const report = await page.evaluate(() => {
  const dbg = window.__streetDebug;
  if (!dbg?.meshes) return { error: 'no debug API' };
  const meshes = dbg.meshes();
  const cones = meshes.filter((m) => {
    const dx = m.max[0] - m.min[0];
    const dy = m.max[1] - m.min[1];
    const dz = m.max[2] - m.min[2];
    const base = Math.max(dx, dz);
    const h = dy;
    return h > 2 && base < h * 0.5 && base < 8;
  });
  const boxes = meshes.filter((m) => {
    const dx = m.max[0] - m.min[0];
    const dy = m.max[1] - m.min[1];
    const dz = m.max[2] - m.min[2];
    return dy > 4 && dx > 2 && dz > 2 && dx / dy < 3 && dz / dy < 3;
  });
  const roads = meshes.filter((m) => m.hasMap && m.tris > 4);
  return {
    meshCount: meshes.length,
    triangles: window.__streetTriangles,
    buildingLike: boxes.length,
    coneLike: cones.length,
    roadLike: roads.length,
    sample: meshes.slice(0, 8),
    conesSample: cones.slice(0, 5),
    boxesSample: boxes.slice(0, 5),
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();

const ok =
  report.triangles > 20 &&
  report.meshCount > 10 &&
  report.buildingLike >= 2 &&
  report.roadLike >= 2;
process.exit(ok ? 0 : 1);
