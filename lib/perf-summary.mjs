export const PERF_SCHEMA_VERSION = 2;
export const PERF_TIMING_LIMIT = 2000;
export const PERF_FRAME_LIMIT = 3000;
export const PERF_RENDERER_LIMIT = 1200;
export const PERF_GPU_TIME_LIMIT = 1200;

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
