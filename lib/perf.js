// Bounded, versioned browser diagnostics used by the benchmark and HUD.
import {
  orderedFrameIntervals,
  orderedGpuFrameTimes,
  orderedPerfTimeline,
  orderedResourceSamples,
  orderedRendererFrames,
  PERF_FRAME_LIMIT,
  PERF_GPU_TIME_LIMIT,
  PERF_RENDERER_LIMIT,
  PERF_RESOURCE_SAMPLE_LIMIT,
  PERF_SCHEMA_VERSION,
  PERF_TIMING_LIMIT,
  summarizeDurationSamples,
  summarizeFrameIntervals,
  summarizeRendererFrames,
} from "./perf-summary.mjs";

export {
  orderedFrameIntervals,
  orderedGpuFrameTimes,
  orderedPerfTimeline,
  orderedResourceSamples,
  orderedRendererFrames,
  PERF_FRAME_LIMIT,
  PERF_GPU_TIME_LIMIT,
  PERF_RENDERER_LIMIT,
  PERF_RESOURCE_SAMPLE_LIMIT,
  PERF_SCHEMA_VERSION,
  PERF_TIMING_LIMIT,
  summarizeDurationSamples,
  summarizeFrameIntervals,
  summarizeRendererFrames,
};

export function createPerfCounters() {
  return {
    schemaVersion: PERF_SCHEMA_VERSION,
    startedAt: now(),
    diagnosticsEnabled: false,
    environment: readBrowserEnvironment(),
    settings: {},
    resourceCounts: {},
    resourceSamples: [],
    resourceSampleCursor: 0,
    unavailableMeasurements: [],
    reactRenders: 0,
    minimapDraws: 0,
    statusUpdates: 0,
    hudUpdates: 0,
    fpsSamples: [],
    frameIntervalsMs: [],
    frameIntervalCursor: 0,
    rendererFrames: [],
    rendererFrameCursor: 0,
    gpuFrameTimesMs: [],
    gpuFrameTimeCursor: 0,
    gpuTimer: { supported: false, reason: "not initialized", disjointSamples: 0, skippedForCapacity: 0 },
    timeline: [],
    timelineCursor: 0,
    marks: {},
    metadata: {},
    validationErrors: [],
  };
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function readBrowserEnvironment() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return {};
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || null,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigator.deviceMemory || null,
    visibilityState: document.visibilityState,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
  };
}

export function ensurePerfCounters(counters) {
  if (!counters || typeof counters !== "object") return createPerfCounters();
  if (counters.diagnosticsEnabled === undefined) counters.diagnosticsEnabled = false;
  if (counters.startedAt === undefined) counters.startedAt = now();
  if (!counters.environment || typeof counters.environment !== "object" || Array.isArray(counters.environment)) counters.environment = readBrowserEnvironment();
  if (!counters.settings || typeof counters.settings !== "object" || Array.isArray(counters.settings)) counters.settings = {};
  if (!counters.resourceCounts || typeof counters.resourceCounts !== "object" || Array.isArray(counters.resourceCounts)) counters.resourceCounts = {};
  if (!Array.isArray(counters.resourceSamples)) counters.resourceSamples = [];
  if (counters.resourceSampleCursor === undefined) counters.resourceSampleCursor = 0;
  if (!Array.isArray(counters.unavailableMeasurements)) counters.unavailableMeasurements = [];
  if (counters.reactRenders === undefined) counters.reactRenders = 0;
  if (counters.minimapDraws === undefined) counters.minimapDraws = 0;
  if (counters.statusUpdates === undefined) counters.statusUpdates = 0;
  if (counters.hudUpdates === undefined) counters.hudUpdates = 0;
  if (!Array.isArray(counters.fpsSamples)) counters.fpsSamples = [];
  if (!Array.isArray(counters.frameIntervalsMs)) counters.frameIntervalsMs = [];
  if (counters.frameIntervalCursor === undefined) counters.frameIntervalCursor = 0;
  if (!Array.isArray(counters.rendererFrames)) counters.rendererFrames = [];
  if (counters.rendererFrameCursor === undefined) counters.rendererFrameCursor = 0;
  if (!Array.isArray(counters.gpuFrameTimesMs)) counters.gpuFrameTimesMs = [];
  if (counters.gpuFrameTimeCursor === undefined) counters.gpuFrameTimeCursor = 0;
  if (!counters.gpuTimer || typeof counters.gpuTimer !== "object") {
    counters.gpuTimer = { supported: false, reason: "not initialized", disjointSamples: 0, skippedForCapacity: 0 };
  }
  if (!Array.isArray(counters.timeline)) counters.timeline = [];
  if (counters.timelineCursor === undefined) counters.timelineCursor = 0;
  if (!counters.marks || typeof counters.marks !== "object" || Array.isArray(counters.marks)) counters.marks = {};
  if (!counters.metadata || typeof counters.metadata !== "object" || Array.isArray(counters.metadata)) counters.metadata = {};
  if (!Array.isArray(counters.validationErrors)) counters.validationErrors = [];
  counters.schemaVersion = PERF_SCHEMA_VERSION;
  return counters;
}

export function appendPerfTiming(counters, name, durationMs, details = {}) {
  if (!counters || !Number.isFinite(durationMs)) return;
  const target = ensurePerfCounters(counters);
  appendBoundedTimeline(target, {
    type: "timing",
    name,
    durationMs: Math.max(0, durationMs),
    atMs: now(),
    details,
  });
}

export function appendPerfMark(counters, name, details = {}) {
  if (!counters) return;
  const target = ensurePerfCounters(counters);
  const atMs = now();
  const mark = { atMs, details };
  if (target.marks[name] === undefined) target.marks[name] = mark;
  appendBoundedTimeline(target, { type: "mark", name, atMs, details });
}

function appendBoundedTimeline(counters, event) {
  const timeline = counters.timeline;
  if (timeline.length < PERF_TIMING_LIMIT) timeline.push(event);
  else {
    const cursor = counters.timelineCursor || 0;
    timeline[cursor] = event;
    counters.timelineCursor = (cursor + 1) % PERF_TIMING_LIMIT;
  }
}

export function appendFrameInterval(counters, intervalMs) {
  if (!counters || !Number.isFinite(intervalMs) || intervalMs <= 0) return;
  const target = ensurePerfCounters(counters);
  const intervals = target.frameIntervalsMs;
  if (intervals.length < PERF_FRAME_LIMIT) intervals.push(intervalMs);
  else {
    const cursor = target.frameIntervalCursor || 0;
    intervals[cursor] = intervalMs;
    target.frameIntervalCursor = (cursor + 1) % PERF_FRAME_LIMIT;
  }
}

export function appendRendererFrame(counters, frame) {
  if (!counters || !frame || !["calls", "triangles", "lines", "points"].every((key) => Number.isFinite(frame[key]) && frame[key] >= 0)) return;
  const target = ensurePerfCounters(counters);
  const frames = target.rendererFrames;
  const sample = { atMs: now(), calls: frame.calls, triangles: frame.triangles, lines: frame.lines, points: frame.points };
  if (frames.length < PERF_RENDERER_LIMIT) frames.push(sample);
  else {
    const cursor = target.rendererFrameCursor || 0;
    frames[cursor] = sample;
    target.rendererFrameCursor = (cursor + 1) % PERF_RENDERER_LIMIT;
  }
}

export function appendGpuFrameTime(counters, durationMs) {
  if (!counters || !Number.isFinite(durationMs) || durationMs < 0) return;
  const target = ensurePerfCounters(counters);
  const samples = target.gpuFrameTimesMs;
  if (samples.length < PERF_GPU_TIME_LIMIT) samples.push(durationMs);
  else {
    const cursor = target.gpuFrameTimeCursor || 0;
    samples[cursor] = durationMs;
    target.gpuFrameTimeCursor = (cursor + 1) % PERF_GPU_TIME_LIMIT;
  }
}

export function getPerfCounters() {
  if (typeof window === "undefined") return null;
  if (!window.__perfCounters) window.__perfCounters = createPerfCounters();
  return ensurePerfCounters(window.__perfCounters);
}

export function recordPerfTiming(name, durationMs, details = {}) {
  if (typeof window === "undefined" || window.__perfCounters?.diagnosticsEnabled !== true) return;
  appendPerfTiming(window.__perfCounters, name, durationMs, details);
}

export function measurePerf(name, callback, details = {}) {
  if (typeof window === "undefined" || window.__perfCounters?.diagnosticsEnabled !== true) return callback();
  const startedAt = now();
  try {
    const result = callback();
    appendPerfTiming(getPerfCounters(), name, now() - startedAt, details);
    return result;
  } catch (error) {
    appendPerfTiming(getPerfCounters(), name, now() - startedAt, { ...details, failed: true });
    throw error;
  }
}

export async function measurePerfAsync(name, callback, details = {}) {
  if (typeof window === "undefined" || window.__perfCounters?.diagnosticsEnabled !== true) return callback();
  const startedAt = now();
  try {
    const result = await callback();
    appendPerfTiming(getPerfCounters(), name, now() - startedAt, details);
    return result;
  } catch (error) {
    appendPerfTiming(getPerfCounters(), name, now() - startedAt, { ...details, failed: true });
    throw error;
  }
}

export function markPerf(name, details = {}) {
  appendPerfMark(getPerfCounters(), name, details);
}

export function setPerfMetadata(metadata = {}) {
  const counters = getPerfCounters();
  if (counters) {
    Object.assign(counters.metadata, metadata);
    Object.assign(counters.settings, metadata);
  }
}

export function setPerfDiagnosticsEnabled(enabled = true) {
  const counters = getPerfCounters();
  if (counters) counters.diagnosticsEnabled = enabled === true;
}

export function setPerfEnvironment(environment = {}) {
  const counters = getPerfCounters();
  if (counters) Object.assign(counters.environment, environment);
}

export function setPerfResourceCounts(resourceCounts = {}) {
  const counters = getPerfCounters();
  if (!counters) return;
  Object.assign(counters.resourceCounts, resourceCounts);
  const samples = counters.resourceSamples;
  const sample = { atMs: now(), ...resourceCounts };
  if (samples.length < PERF_RESOURCE_SAMPLE_LIMIT) samples.push(sample);
  else {
    const cursor = counters.resourceSampleCursor || 0;
    samples[cursor] = sample;
    counters.resourceSampleCursor = (cursor + 1) % PERF_RESOURCE_SAMPLE_LIMIT;
  }
}

export function markPerfMeasurementUnavailable(name, reason) {
  const counters = getPerfCounters();
  if (!counters || counters.unavailableMeasurements.some((entry) => entry.name === name)) return;
  counters.unavailableMeasurements.push({ name, reason });
}

export function recordPerfValidationError(error, details = {}) {
  const counters = getPerfCounters();
  if (!counters) return;
  counters.validationErrors.push({
    message: String(error?.message || error),
    atMs: now(),
    details,
  });
  if (counters.validationErrors.length > 100) counters.validationErrors.shift();
}

export function trackRender() {
  const c = getPerfCounters();
  if (c) c.reactRenders++;
}

export function trackStatusUpdate() {
  const c = getPerfCounters();
  if (c) c.statusUpdates++;
}

export function trackHudUpdate() {
  const c = getPerfCounters();
  if (c) c.hudUpdates++;
}

export function trackMinimapDraw() {
  const c = getPerfCounters();
  if (c) c.minimapDraws++;
}

export function recordFrameInterval(intervalMs) {
  appendFrameInterval(getPerfCounters(), intervalMs);
}

export function recordFpsSample(fps) {
  const c = getPerfCounters();
  if (c && fps > 0) {
    c.fpsSamples.push(fps);
    if (c.fpsSamples.length > 600) c.fpsSamples.shift();
  }
}
