export const PERF_SCHEMA_VERSION = 2;
export const PERF_TIMING_LIMIT = 2000;
export const PERF_FRAME_LIMIT = 3000;
export const PERF_RENDERER_LIMIT = 1200;
export const PERF_GPU_TIME_LIMIT = 1200;

export function validateBenchmarkMeasurement({
  requestedWalkMs,
  wallElapsedMs,
  frameDurationMs,
  frameSampleCount,
  rendererSampleCount,
  gpuSampleCount,
  visibilityState,
  pageHasFocus,
  focusLossCount = 0,
  visibilityLossCount = 0,
}) {
  const reasons = [];
  const lowerWallBoundMs = requestedWalkMs * 0.9;
  const upperWallBoundMs = requestedWalkMs * 1.5;

  if (!Number.isFinite(wallElapsedMs) || wallElapsedMs < lowerWallBoundMs || wallElapsedMs > upperWallBoundMs) {
    reasons.push(`Observed wall duration ${Math.round(wallElapsedMs)}ms is outside ${Math.round(lowerWallBoundMs)}–${Math.round(upperWallBoundMs)}ms`);
  }
  if (visibilityState && visibilityState !== 'visible') reasons.push(`Page visibility was ${visibilityState} during the measurement`);
  if (pageHasFocus === false) reasons.push('Browser page did not have focus during the measurement');
  if (focusLossCount > 0) reasons.push(`Browser page lost focus ${focusLossCount} time(s) during the measurement`);
  if (visibilityLossCount > 0) reasons.push(`Page became hidden ${visibilityLossCount} time(s) during the measurement`);
  if (!Number.isFinite(frameDurationMs) || frameSampleCount < 2) {
    reasons.push('Frame interval history does not contain enough samples to measure a window');
  } else if (Math.abs(frameDurationMs - wallElapsedMs) > Math.max(1000, wallElapsedMs * 0.15)) {
    reasons.push(`Frame history covers ${Math.round(frameDurationMs)}ms, which does not match the ${Math.round(wallElapsedMs)}ms measurement window`);
  }
  if (frameSampleCount >= PERF_FRAME_LIMIT) reasons.push(`Frame interval history reached its ${PERF_FRAME_LIMIT}-sample limit`);
  if (rendererSampleCount >= PERF_RENDERER_LIMIT) reasons.push(`Renderer history reached its ${PERF_RENDERER_LIMIT}-sample limit`);
  if (gpuSampleCount >= PERF_GPU_TIME_LIMIT) reasons.push(`GPU timer history reached its ${PERF_GPU_TIME_LIMIT}-sample limit`);

  return {
    valid: reasons.length === 0,
    requestedWalkMs,
    wallElapsedMs: Math.round(wallElapsedMs),
    frameDurationMs: Number.isFinite(frameDurationMs) ? Math.round(frameDurationMs) : null,
    frameSampleCount,
    rendererSampleCount,
    gpuSampleCount,
    frameCoverageRatio: Number.isFinite(frameDurationMs) && wallElapsedMs > 0
      ? Number((frameDurationMs / wallElapsedMs).toFixed(3))
      : null,
    reasons,
  };
}

export function orderedPerfTimeline(counters) {
  const timeline = counters?.timeline || [];
  const cursor = counters?.timelineCursor || 0;
  if (timeline.length < PERF_TIMING_LIMIT || cursor === 0) return timeline.slice();
  return [...timeline.slice(cursor), ...timeline.slice(0, cursor)];
}

export function orderedFrameIntervals(counters) {
  const intervals = counters?.frameIntervalsMs || [];
  const cursor = counters?.frameIntervalCursor || 0;
  if (intervals.length < PERF_FRAME_LIMIT || cursor === 0) return intervals.slice();
  return [...intervals.slice(cursor), ...intervals.slice(0, cursor)];
}

export function orderedRendererFrames(counters) {
  return orderedRing(counters?.rendererFrames, counters?.rendererFrameCursor, PERF_RENDERER_LIMIT);
}

export function orderedGpuFrameTimes(counters) {
  return orderedRing(counters?.gpuFrameTimesMs, counters?.gpuFrameTimeCursor, PERF_GPU_TIME_LIMIT);
}

export function orderedRendererFramesSummary(counters) {
  return summarizeRendererFrames(orderedRendererFrames(counters));
}

function orderedRing(values = [], cursor = 0, limit) {
  if (values.length < limit || cursor === 0) return values.slice();
  return [...values.slice(cursor), ...values.slice(0, cursor)];
}

export function summarizeDurationSamples(durationsMs = []) {
  const samples = durationsMs.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!samples.length) return { sampleCount: 0, meanMs: null, p50Ms: null, p95Ms: null, p99Ms: null };
  const percentile = (fraction) => samples[Math.max(0, Math.ceil(samples.length * fraction) - 1)];
  return {
    sampleCount: samples.length,
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50Ms: percentile(0.50),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
  };
}

export function summarizeRendererFrames(frames = []) {
  const fields = ["calls", "triangles", "lines", "points"];
  const summary = { sampleCount: frames.length };
  for (const field of fields) {
    const values = frames.map((frame) => frame[field]).filter((value) => Number.isFinite(value) && value >= 0);
    summary[field] = {
      total: values.reduce((sum, value) => sum + value, 0),
      meanPerFrame: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      maxPerFrame: values.length ? Math.max(...values) : null,
    };
  }
  return summary;
}

export function summarizeFrameIntervals(frameIntervalsMs = []) {
  const samples = frameIntervalsMs.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!samples.length) {
    return {
      sampleCount: 0,
      durationMs: 0,
      meanFrameTimeMs: null,
      p50FrameTimeMs: null,
      p95FrameTimeMs: null,
      p99FrameTimeMs: null,
      onePercentLowFps: null,
      framesOver50Ms: 0,
      framesOver100Ms: 0,
    };
  }
  const percentile = (fraction) => samples[Math.max(0, Math.ceil(samples.length * fraction) - 1)];
  const slowCount = Math.max(1, Math.ceil(samples.length * 0.01));
  const slowMean = samples.slice(-slowCount).reduce((sum, value) => sum + value, 0) / slowCount;
  return {
    sampleCount: samples.length,
    durationMs: Math.round(samples.reduce((sum, value) => sum + value, 0)),
    meanFrameTimeMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50FrameTimeMs: percentile(0.50),
    p95FrameTimeMs: percentile(0.95),
    p99FrameTimeMs: percentile(0.99),
    onePercentLowFps: 1000 / slowMean,
    framesOver50Ms: samples.filter((value) => value > 50).length,
    framesOver100Ms: samples.filter((value) => value > 100).length,
  };
}
