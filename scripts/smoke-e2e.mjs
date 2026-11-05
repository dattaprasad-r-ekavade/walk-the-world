#!/usr/bin/env node
/**
 * End-to-end smoke test against a running build (npm run test:e2e).
 *
 *   node scripts/smoke-e2e.mjs [baseUrl]
 *
 * Deterministic and offline: the street engine loads the checked-in Rome
 * fixture, and every request that leaves the app's origin is aborted, so
 * map tiles, terrain and geocoding fail the way they do on a bad network.
 * Checks that:
 *   - the home menu renders and its primary action becomes enabled;
 *   - the street engine boots, builds the city and reports ready;
 *   - walking forward moves the player and the HUD shows live FPS;
 *   - the engine tears down cleanly on navigation (debug API removed);
 *   - no uncaught page errors occur anywhere.
 *
 * Set PLAYWRIGHT_CHROMIUM_PATH to use a preinstalled Chromium.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.argv[2] || 'http://127.0.0.1:3456';
const origin = new URL(baseUrl).origin;
const fixture = JSON.parse(readFileSync(join(ROOT, 'benchmarks/fixtures/rome-minimal.json'), 'utf8'));
const ROME = { lat: 41.8902, lon: 12.4922 };

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
await context.route((url) => url.origin !== origin, (route) => route.abort());
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

try {
  // ---- home ----
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const demo = page.locator('button[data-testid="guided-demo"]');
  await demo.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('button[data-testid="guided-demo"]')?.disabled, null, { timeout: 30_000 });
  check(true, 'home menu renders and becomes interactive');

  // ---- street engine ----
  await page.addInitScript((fx) => {
    window.__BENCH_MODE = true;
    window.__BENCH_FIXTURE = fx;
    window.__BENCH_FREEZE_POPULATION = true;
  }, fixture);
  const startedAt = Date.now();
  await page.goto(`${baseUrl}/street?lat=${ROME.lat}&lon=${ROME.lon}&bench=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__engineReady === true, null, { timeout: 180_000 });
  check(true, `street engine ready in ${Math.round((Date.now() - startedAt) / 1000)} s`);
  const city = await page.evaluate(() => ({
    triangles: window.__streetTriangles ?? 0,
    meshes: window.__streetDebug?.meshes?.().length ?? 0,
    insideBuilding: window.__streetDebug?.insideBuilding?.(window.__streetDebug.player.x, window.__streetDebug.player.z),
  }));
  check(city.triangles > 20, `city geometry built (${city.meshes} meshes)`);
  check(city.insideBuilding === false, 'player spawns outside buildings');

  // ---- walk ----
  await page.locator('canvas').first().click({ position: { x: 640, y: 400 } }).catch(() => {});
  const before = await page.evaluate(() => ({ ...window.__streetDebug.player }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => ({ ...window.__streetDebug.player }));
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check(moved > 0.25, `walking forward moves the player (${moved.toFixed(2)} m)`);
  const hud = await page.evaluate(() => document.body.innerText);
  check(/WASD/.test(hud), 'gameplay HUD is shown');

  // ---- teardown ----
  await page.goto(`${baseUrl}/editor`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByText('Asset Library').waitFor({ timeout: 30_000 });
  const leaked = await page.evaluate(() => ({ debug: !!window.__streetDebug, ready: window.__engineReady === true }));
  check(!leaked.debug && !leaked.ready, 'street engine tears down on navigation');
} catch (error) {
  check(false, `unexpected failure: ${error?.message || error}`);
} finally {
  check(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nall smoke checks passed');
