import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const baseUrl = new URL(option('--base-url', 'http://127.0.0.1:3457'));
const outputOption = option('--out', null);
const outputPath = outputOption
  ? (isAbsolute(outputOption) ? outputOption : resolve(ROOT, outputOption))
  : null;

if (!['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname)) {
  throw new Error('--base-url must point to a local server');
}

const manifest = JSON.parse(readFileSync(resolve(ROOT, 'public/textures/ktx2/runtime-manifest.json'), 'utf8'));
const contentPaths = [
  `/${manifest.textures['facade-basecolor'].file}`,
  `/${manifest.textures['facade-near-basecolor'].file}`,
  `/${manifest.nearAtlasLayout.file}`,
  `${manifest.decoderPath}basis_transcoder.wasm`,
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'allow' });
const page = await context.newPage();
const result = {
  schemaVersion: 1,
  baseUrl: baseUrl.origin,
  browser: { engine: 'Chrome', version: browser.version() },
  manifestRevision: manifest.revision,
  checks: [],
};

try {
  await page.goto(baseUrl.origin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => 'serviceWorker' in navigator, null, { timeout: 10_000 });
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state === 'activated';
  }, null, { timeout: 15_000 });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15_000 });
  }
  const workerState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const cacheNames = await caches.keys();
    const shellCaches = cacheNames.filter((name) => name.startsWith('wtw-shell-'));
    const shellCache = shellCaches.length ? await caches.open(shellCaches.at(-1)) : null;
    return {
      controlled: !!navigator.serviceWorker.controller,
      activeState: registration.active?.state ?? null,
      cacheNames,
      shellCacheName: shellCaches.at(-1) ?? null,
      shellRootCached: shellCache ? !!(await shellCache.match('/')) : false,
    };
  });
  if (!workerState.controlled || workerState.activeState !== 'activated' || !workerState.shellRootCached) {
    throw new Error(`Service worker did not control a cached shell: ${JSON.stringify(workerState)}`);
  }
  result.serviceWorker = workerState;

  for (const path of contentPaths) {
    const response = await page.evaluate(async (assetPath) => {
      const response = await fetch(assetPath);
      const body = await response.arrayBuffer();
      return { status: response.status, bytes: body.byteLength };
    }, path);
    await page.waitForFunction(async (assetPath) => {
      const names = (await caches.keys()).filter((name) => name.startsWith('wtw-shell-'));
      if (!names.length) return false;
      const cache = await caches.open(names.at(-1));
      return !!(await cache.match(new URL(assetPath, location.origin).href));
    }, path, { timeout: 10_000 });
    if (response.status !== 200 || response.bytes < 1) {
      throw new Error(`Could not prime ${path}: ${JSON.stringify(response)}`);
    }
    result.checks.push({ path, onlineStatus: response.status, bytes: response.bytes, cached: true });
  }

  const streetUrl = new URL('/street?lat=41.890&lon=12.500', baseUrl.origin).href;
  const warmNavigation = await page.goto(streetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (!warmNavigation || warmNavigation.status() !== 200) {
    throw new Error(`Street route could not be primed: ${warmNavigation?.status() ?? 'no response'}`);
  }
  await page.waitForFunction(async (url) => {
    const names = (await caches.keys()).filter((name) => name.startsWith('wtw-shell-'));
    if (!names.length) return false;
    const cache = await caches.open(names.at(-1));
    return !!(await cache.match(url));
  }, streetUrl, { timeout: 10_000 });

  await context.setOffline(true);
  const offlineAssetResults = [];
  for (const path of contentPaths) {
    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === path, { timeout: 10_000 });
    const body = await page.evaluate(async (assetPath) => {
      const response = await fetch(assetPath, { cache: 'no-store' });
      return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    }, path);
    const response = await responsePromise;
    const fromServiceWorker = response.fromServiceWorker();
    if (body.status !== 200 || body.bytes < 1 || !fromServiceWorker) {
      throw new Error(`Offline cached asset failed: ${path} ${JSON.stringify({ ...body, fromServiceWorker })}`);
    }
    offlineAssetResults.push({ path, ...body, fromServiceWorker });
  }
  result.offlineAssets = offlineAssetResults;

  const missingPath = '/textures/ktx2/facade-unavailable.deadbeefdeadbeef.ktx2';
  const miss = await page.evaluate(async (assetPath) => {
    try {
      const response = await fetch(assetPath, { cache: 'no-store' });
      return { rejected: false, status: response.status };
    } catch (error) {
      return { rejected: true, error: String(error) };
    }
  }, missingPath);
  result.offlineCacheMissProbe = {
    path: missingPath,
    ...miss,
    cacheEntryPresent: await page.evaluate(async (assetPath) => {
      const names = (await caches.keys()).filter((name) => name.startsWith('wtw-shell-'));
      if (!names.length) return false;
      const cache = await caches.open(names.at(-1));
      return !!(await cache.match(new URL(assetPath, location.origin).href));
    }, missingPath),
    verdict: miss.rejected
      ? 'Network failure reached the service-worker fallback.'
      : 'Unverified: Chromium still reached the loopback server while offline mode was enabled.',
  };

  const offlineNavigation = await page.goto(streetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  if (!offlineNavigation || offlineNavigation.status() !== 200 || !offlineNavigation.fromServiceWorker()) {
    throw new Error(`Offline route navigation did not use the cached response: ${JSON.stringify({ status: offlineNavigation?.status(), fromServiceWorker: offlineNavigation?.fromServiceWorker() })}`);
  }
  result.offlineNavigation = { status: offlineNavigation.status(), fromServiceWorker: offlineNavigation.fromServiceWorker(), url: offlineNavigation.url() };
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}
