import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
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
if (baseUrl.protocol !== 'http:' || baseUrl.pathname !== '/') {
  throw new Error('--base-url must be an HTTP origin without a path');
}

const missingPath = '/textures/ktx2/facade-unavailable.deadbeefdeadbeef.ktx2';
let rejectedNetworkFailureProbeCount = 0;
const failureProxy = createServer((incoming, outgoing) => {
  const path = new URL(incoming.url || '/', 'http://127.0.0.1').pathname;
  if (path === missingPath) {
    rejectedNetworkFailureProbeCount++;
    incoming.socket.destroy();
    return;
  }

  const upstream = httpRequest({
    hostname: baseUrl.hostname.replace(/^\[|\]$/gu, ''),
    port: Number(baseUrl.port || 80),
    method: incoming.method,
    path: incoming.url,
    headers: { ...incoming.headers, host: baseUrl.host },
  }, (response) => {
    outgoing.writeHead(response.statusCode || 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
});
await new Promise((resolveListen, rejectListen) => {
  failureProxy.once('error', rejectListen);
  failureProxy.listen(0, '127.0.0.1', resolveListen);
});
const proxyAddress = failureProxy.address();
const testOrigin = `http://127.0.0.1:${proxyAddress.port}`;

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
  baseUrl: testOrigin,
  upstreamBaseUrl: baseUrl.origin,
  browser: { engine: 'Chrome', version: browser.version() },
  manifestRevision: manifest.revision,
  offlineProbeOrigin: 'Fresh local reverse-proxy origin for an uncached request failure check.',
  checks: [],
};

try {
  await page.goto(testOrigin, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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

  const streetUrl = new URL('/street?lat=41.890&lon=12.500', testOrigin).href;
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

  await context.setOffline(false);
  const networkFailureProbe = await page.evaluate(async (assetPath) => {
    const controlled = !!navigator.serviceWorker.controller;
    const online = navigator.onLine;
    try {
      const response = await fetch(assetPath, { cache: 'no-store' });
      return { controlled, online, rejected: false, status: response.status };
    } catch (error) {
      return { controlled, online, rejected: true, error: String(error) };
    }
  }, missingPath);
  const networkFailureCacheEntryPresent = await page.evaluate(async (assetPath) => {
    const names = (await caches.keys()).filter((name) => name.startsWith('wtw-shell-'));
    if (!names.length) return false;
    const cache = await caches.open(names.at(-1));
    return !!(await cache.match(new URL(assetPath, location.origin).href));
  }, missingPath);
  result.uncachedNetworkFailureProbe = {
    path: missingPath,
    ...networkFailureProbe,
    cacheEntryPresent: networkFailureCacheEntryPresent,
    proxyResetCount: rejectedNetworkFailureProbeCount,
    verdict: networkFailureProbe.controlled && networkFailureProbe.online && networkFailureProbe.rejected &&
      !networkFailureCacheEntryPresent && rejectedNetworkFailureProbeCount > 0
      ? 'Passed: the controlled service worker received an uncached network request that the proxy reset.'
      : 'Failed: the forced network failure did not exercise the service-worker fallback.',
  };
  if (!networkFailureProbe.controlled || !networkFailureProbe.online || !networkFailureProbe.rejected ||
      networkFailureCacheEntryPresent || rejectedNetworkFailureProbeCount === 0) {
    throw new Error(`Uncached network failure did not reach the service-worker fallback: ${JSON.stringify(result.uncachedNetworkFailureProbe)}`);
  }

  await context.setOffline(true);
  const miss = await page.evaluate(async (assetPath) => {
    const controlled = !!navigator.serviceWorker.controller;
    const online = navigator.onLine;
    try {
      const response = await fetch(assetPath, { cache: 'no-store' });
      return { controlled, online, rejected: false, status: response.status };
    } catch (error) {
      return { controlled, online, rejected: true, error: String(error) };
    }
  }, missingPath);
  const cacheEntryPresent = await page.evaluate(async (assetPath) => {
    const names = (await caches.keys()).filter((name) => name.startsWith('wtw-shell-'));
    if (!names.length) return false;
    const cache = await caches.open(names.at(-1));
    return !!(await cache.match(new URL(assetPath, location.origin).href));
  }, missingPath);
  result.offlineCacheMissProbe = {
    path: missingPath,
    ...miss,
    cacheEntryPresent,
    verdict: miss.controlled && !miss.online && miss.rejected && !cacheEntryPresent
      ? 'Passed: the controlled page was offline and its uncached request failed.'
      : 'Failed: the uncached request did not exercise the offline fallback.',
  };
  if (!miss.controlled || miss.online || !miss.rejected || cacheEntryPresent) {
    throw new Error(`Uncached offline miss did not reach the service-worker network-error fallback: ${JSON.stringify(result.offlineCacheMissProbe)}`);
  }

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
  await new Promise((resolveClose) => failureProxy.close(resolveClose));
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}
