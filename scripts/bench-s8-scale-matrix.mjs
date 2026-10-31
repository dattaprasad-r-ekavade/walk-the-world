#!/usr/bin/env node
/**
 * Run the S8 five-pair render-scale comparison on the target Intel laptop.
 * By default this validates the staged inputs and prints the 40-run schedule.
 * Pass --run to launch Chrome and execute the full matrix.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_PLACES } from '../lib/geo.js';
import { cellNeighborhood, cityCacheKey } from '../lib/city-contract.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function option(name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Expected a value after ${name}`);
  return value;
}

function help() {
  console.log(`Usage: npm run bench:s8 -- [options]

Prepare a 40-capture S8 matrix: five alternating pairs at scale 1.0 and 0.85
for Pune, Edinburgh, Tokyo and New York, using the same recorded 3x3 cells.

Options:
  --cell-dir <path>  Directory of <city-cache-key>.json OSM cell files.
                     Defaults to .cell-refresh-staging/hpi-demo-2026-10-31/candidates
  --base-url <url>   Local production server URL (default http://127.0.0.1:3456)
  --out-dir <path>   New output directory (default: timestamped under
                     .cell-refresh-staging/)
  --run              Launch the full matrix. Without this flag, only preflight
                     and schedule generation run.
  --help             Show this help.

The run requires a clean tracked worktree, Windows, an i5-1035G1 host, and
Chrome selecting Intel UHD Graphics. The local server must already be running
from the same production build. Output and generated fixture files stay local.`);
}

if (args.includes('--help')) {
  help();
  process.exit(0);
}

const cellDirOption = option('--cell-dir', '.cell-refresh-staging/hpi-demo-2026-10-31/candidates');
const cellDir = isAbsolute(cellDirOption) ? cellDirOption : resolve(ROOT, cellDirOption);
const baseUrl = option('--base-url', 'http://127.0.0.1:3456');
const base = new URL(baseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(base.hostname)) {
  throw new Error('--base-url must point to a local production server');
}
const runEnabled = args.includes('--run');
const dryRun = !runEnabled;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outOption = option('--out-dir', `.cell-refresh-staging/s8-target-matrix-${timestamp}`);
const outDir = isAbsolute(outOption) ? outOption : resolve(ROOT, outOption);
if (runEnabled && existsSync(outDir)) {
  throw new Error(`Output directory already exists; choose a new --out-dir: ${outDir}`);
}
if (!existsSync(cellDir)) throw new Error(`Cell directory does not exist: ${cellDir}`);

const scaleRuns = [1, 0.85];
const pairsPerCity = 5;
const expectedCpuToken = 'i5-1035g1';
const expectedRendererTokens = ['intel', 'uhd'];
const fixtureDir = join(outDir, 'fixtures');
const cityFixtures = new Map();
const inputSummary = [];

for (const place of DEMO_PLACES) {
  const cellPayloads = {};
  const keys = cellNeighborhood(place.lat, place.lon).map(([lat, lon]) => cityCacheKey(lat, lon));
  for (const key of keys) {
    const sourcePath = join(cellDir, `${key}.json`);
    if (!existsSync(sourcePath)) throw new Error(`${place.name}: missing recorded 3x3 cell ${sourcePath}`);
    const payload = JSON.parse(readFileSync(sourcePath, 'utf8'));
    if (!payload || !Array.isArray(payload.elements) || payload.elements.length === 0) {
      throw new Error(`${place.name}: ${key} has no OSM elements`);
    }
    cellPayloads[key] = payload;
    inputSummary.push({ city: place.name, key, elements: payload.elements.length });
  }
  cityFixtures.set(place.name, {
    place,
    payload: { cellPayloads },
    path: join(fixtureDir, `${place.name.toLowerCase().replace(/\s+/g, '-')}-3x3.json`),
  });
}

const schedule = [];
for (let pair = 1; pair <= pairsPerCity; pair++) {
  const pairOrder = pair % 2 === 1 ? scaleRuns : [...scaleRuns].reverse();
  for (const place of DEMO_PLACES) {
    for (const scale of pairOrder) {
      const slug = place.name.toLowerCase().replace(/\s+/g, '-');
      const scaleName = scale === 1 ? '1.00' : '0.85';
      const file = join(outDir, `${slug}-pair-${pair}-scale-${scaleName}.json`);
      const fixturePath = cityFixtures.get(place.name).path;
      const commandArgs = [
        join(ROOT, 'scripts', 'bench-perf.mjs'),
        '--base-url', baseUrl,
        '--data-mode', 'recorded',
        '--cache-mode', 'cold',
        '--fixture', fixturePath,
        '--lat', String(place.lat),
        '--lon', String(place.lon),
        '--preset', 'medium',
        '--quality-mode', 'auto',
        '--render-scale', String(scale),
        '--hour', '21',
        '--weather', '0',
        '--walk-ms', '8000',
        '--seed', '1337',
        '--browser-channel', 'chrome',
        '--renderer-mode', 'browser-default',
        '--headed',
        '--skip-globe',
        '--out', file,
      ];
      schedule.push({ city: place.name, pair, scale, file, fixturePath, commandArgs });
    }
  }
}

console.log(`S8 preflight: ${inputSummary.length} OSM cells across ${DEMO_PLACES.length} cities; ${schedule.length} captures (${pairsPerCity} alternating pairs per city).`);
console.log(`Cell source: ${cellDir}`);
console.log(`Output: ${outDir}`);
for (const place of DEMO_PLACES) {
  const count = inputSummary.filter((cell) => cell.city === place.name).length;
  console.log(`  ${place.name}: ${count}/9 cells`);
}

if (dryRun) {
  console.log('Preflight passed. No files were written and no benchmark was launched. Pass --run to execute all 40 captures.');
  process.exit(0);
}

if (process.platform !== 'win32') throw new Error('The target S8 matrix requires Windows host telemetry.');
const cpuModel = cpus()[0]?.model || '';
if (!cpuModel.toLowerCase().includes(expectedCpuToken)) {
  throw new Error(`S8 target CPU required (${expectedCpuToken}); detected: ${cpuModel || 'unknown'}`);
}
const workingChanges = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
if (workingChanges) throw new Error('S8 requires a clean worktree so all 40 captures use one source revision.');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
mkdirSync(fixtureDir, { recursive: true });
for (const fixture of cityFixtures.values()) {
  writeFileSync(fixture.path, `${JSON.stringify(fixture.payload)}\n`);
}

function runChild(entry) {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, entry.commandArgs, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    child.once('error', rejectChild);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveChild();
      else rejectChild(new Error(`Benchmark failed for ${entry.city}, pair ${entry.pair}, scale ${entry.scale} (exit ${code ?? signal})`));
    });
  });
}

function assertRun(entry) {
  const report = JSON.parse(readFileSync(entry.file, 'utf8'));
  const scenario = report.scenario || {};
  const street = report.street || {};
  const environment = street.environment || {};
  const renderer = environment.webgl?.renderer || '';
  const cpuNames = (street.hostTelemetry?.host?.cpu || []).map((cpu) => cpu.name || '').join(' ');
  const failures = [];
  if (report.sourceRevision !== sourceRevision) failures.push(`source revision ${report.sourceRevision} != ${sourceRevision}`);
  if (report.sourceTreeDirty !== false) failures.push('source tree was dirty');
  if (scenario.qualityPreset !== 'medium' || scenario.qualityMode !== 'auto') failures.push('quality mode/preset mismatch');
  if (scenario.benchmarkRenderScale !== entry.scale || Math.abs(street.renderScale - entry.scale) > 0.001) failures.push('requested render scale was not applied');
  if (scenario.dataMode !== 'recorded' || scenario.cacheMode !== 'cold') failures.push('recorded cold-cache mode mismatch');
  if (scenario.hour !== 21 || scenario.weather !== 0 || scenario.walkDurationMs !== 8000 || scenario.seed !== 1337) failures.push('scene or walk settings mismatch');
  if (street.qualityTier !== 'medium') failures.push(`auto quality tier was ${street.qualityTier || 'unknown'}, expected medium`);
  if (street.integratedGpu !== true) failures.push('runtime did not identify an integrated GPU');
  if (!expectedRendererTokens.every((token) => renderer.toLowerCase().includes(token))) failures.push(`unexpected WebGL renderer: ${renderer || 'unknown'}`);
  if (!cpuNames.toLowerCase().includes(expectedCpuToken)) failures.push(`unexpected host CPU: ${cpuNames || 'unavailable'}`);
  if (environment.visibilityState !== 'visible' || environment.hasFocus !== true || environment.focusLossCount !== 0 || environment.visibilityLossCount !== 0) failures.push('browser was not foregrounded for the full capture');
  if (street.measurementWindow?.valid !== true) failures.push(`invalid measurement window: ${(street.measurementWindow?.reasons || []).join(', ')}`);
  if (!(street.frameSummary?.sampleCount > 0) || !Number.isFinite(street.frameSummary?.p95FrameTimeMs)) failures.push('frame-time p95 is unavailable');
  if (!(street.gpuFrameSummary?.sampleCount > 0) || !Number.isFinite(street.gpuFrameSummary?.p95Ms)) failures.push('GPU-timer p95 is unavailable');
  if ((street.validationErrors || []).length > 0) failures.push('benchmark validation errors were reported');
  if ((report.diagnostics?.consoleErrors || []).length || (report.diagnostics?.pageErrors || []).length || (report.diagnostics?.assetFailures || []).length) failures.push('browser diagnostics contain errors');
  if ((report.networkTelemetry?.httpErrorResponses || 0) > 0) failures.push('HTTP error responses were observed');
  if (failures.length) throw new Error(`${entry.city}, pair ${entry.pair}, scale ${entry.scale}: ${failures.join('; ')}`);
  return {
    city: entry.city,
    pair: entry.pair,
    scale: entry.scale,
    file: entry.file,
    frameP95Ms: street.frameSummary.p95FrameTimeMs,
    gpuP95Ms: street.gpuFrameSummary.p95Ms,
    frameSamples: street.frameSummary.sampleCount,
    gpuSamples: street.gpuFrameSummary.sampleCount,
    renderer,
    host: street.hostTelemetry?.host || null,
  };
}

const runs = [];
for (const [index, entry] of schedule.entries()) {
  console.log(`\n[${index + 1}/${schedule.length}] ${entry.city}, pair ${entry.pair}, scale ${entry.scale}`);
  await runChild(entry);
  runs.push(assertRun(entry));
}

const median = (values) => {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
};
const summaries = DEMO_PLACES.map((place) => {
  const baseline = runs.filter((run) => run.city === place.name && run.scale === 1);
  const candidate = runs.filter((run) => run.city === place.name && run.scale === 0.85);
  if (baseline.length !== pairsPerCity || candidate.length !== pairsPerCity) {
    throw new Error(`${place.name}: expected ${pairsPerCity} valid runs per scale; got ${baseline.length}/${candidate.length}`);
  }
  const baselineFrameP95Ms = median(baseline.map((run) => run.frameP95Ms));
  const candidateFrameP95Ms = median(candidate.map((run) => run.frameP95Ms));
  const baselineGpuP95Ms = median(baseline.map((run) => run.gpuP95Ms));
  const candidateGpuP95Ms = median(candidate.map((run) => run.gpuP95Ms));
  return {
    city: place.name,
    baselineFrameP95Ms,
    candidateFrameP95Ms,
    frameP95ChangePct: (candidateFrameP95Ms / baselineFrameP95Ms - 1) * 100,
    baselineFrameP95RangeMs: [Math.min(...baseline.map((run) => run.frameP95Ms)), Math.max(...baseline.map((run) => run.frameP95Ms))],
    candidateFrameP95RangeMs: [Math.min(...candidate.map((run) => run.frameP95Ms)), Math.max(...candidate.map((run) => run.frameP95Ms))],
    baselineGpuP95Ms,
    candidateGpuP95Ms,
    gpuP95ChangePct: (candidateGpuP95Ms / baselineGpuP95Ms - 1) * 100,
  };
});

const output = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  sourceRevision,
  host: runs[0]?.host || null,
  renderer: runs[0]?.renderer || null,
  protocol: {
    pairsPerCity,
    scales: scaleRuns,
    cities: DEMO_PLACES.map(({ name, lat, lon }) => ({ name, lat, lon })),
    hour: 21,
    weather: 0,
    walkMs: 8000,
    qualityPreset: 'medium',
    qualityMode: 'auto',
    cacheMode: 'cold',
    fixtureCellCountPerCity: 9,
    expectedCpu: 'Intel Core i5-1035G1',
    expectedRenderer: 'Intel UHD Graphics',
  },
  runs,
  summaries,
  passesFrameP95Gate: summaries.every((summary) => summary.frameP95ChangePct <= -10),
};
writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(output, null, 2)}\n`);
const rows = summaries.map((summary) =>
  `| ${summary.city} | ${summary.baselineFrameP95Ms.toFixed(2)} | ${summary.candidateFrameP95Ms.toFixed(2)} | ${summary.frameP95ChangePct.toFixed(1)}% | ${summary.baselineGpuP95Ms.toFixed(2)} | ${summary.candidateGpuP95Ms.toFixed(2)} | ${summary.gpuP95ChangePct.toFixed(1)}% |`
);
const markdown = [
  '# S8 target Intel render-scale matrix',
  '',
  `Source revision: \`${sourceRevision}\``,
  `Host: ${output.host?.manufacturer || 'unknown'} ${output.host?.model || ''}; ${(output.host?.cpu || []).map((cpu) => cpu.name).join(', ') || 'CPU unavailable'}.`,
  `WebGL renderer: ${output.renderer || 'unknown'}.`,
  '',
  'Five alternating cold-cache pairs per city; medium auto quality; 21:00 clear; 8-second walk; identical recorded 3×3 cells.',
  '',
  '| City | Frame p95 1.0 (ms) | Frame p95 0.85 (ms) | Change | GPU p95 1.0 (ms) | GPU p95 0.85 (ms) | Change |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...rows,
  '',
  `Frame-p95 gate (at least 10% lower in each city): **${output.passesFrameP95Gate ? 'pass' : 'not met'}**.`,
  '',
  `Machine-readable captures and generated fixtures: \`${outDir}\`.`,
  '',
].join('\n');
writeFileSync(join(outDir, 'summary.md'), markdown);
console.log(`\nS8 matrix complete. Frame-p95 gate: ${output.passesFrameP95Gate ? 'PASS' : 'not met'}.`);
console.log(`Summary: ${join(outDir, 'summary.md')}`);
