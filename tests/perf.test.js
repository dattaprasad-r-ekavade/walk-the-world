import { describe, expect, it } from "vitest";
import {
  appendFrameInterval,
  appendGpuFrameTime,
  appendPerfMark,
  appendPerfTiming,
  appendRendererFrame,
  createPerfCounters,
  ensurePerfCounters,
  orderedFrameIntervals,
  orderedGpuFrameTimes,
  orderedPerfTimeline,
  orderedResourceSamples,
  orderedRendererFrames,
  PERF_RESOURCE_SAMPLE_LIMIT,
  summarizeFrameIntervals,
  summarizeDurationSamples,
  summarizeRendererFrames,
  PERF_FRAME_LIMIT,
  PERF_GPU_TIME_LIMIT,
  PERF_RENDERER_LIMIT,
  PERF_TIMING_LIMIT,
} from "@/lib/perf";
import { createGpuFrameTimer } from "@/lib/engine/gpu-frame-timer";
import {
  summarizeResourceStability,
  validateBenchmarkMeasurement,
  validateResourceSoak,
} from "@/lib/perf-summary.mjs";

describe("performance diagnostics", () => {
  it("accepts a complete frame window that matches the requested walk", () => {
    expect(validateBenchmarkMeasurement({
      requestedWalkMs: 12_000,
      wallElapsedMs: 12_030,
      frameDurationMs: 11_980,
      frameSampleCount: 720,
      rendererSampleCount: 720,
      gpuSampleCount: 650,
    })).toMatchObject({ valid: true, frameCoverageRatio: 0.996, reasons: [] });
  });

  it("rejects incomplete or saturated benchmark windows", () => {
    const result = validateBenchmarkMeasurement({
      requestedWalkMs: 12_000,
      wallElapsedMs: 12_030,
      frameDurationMs: 51_977,
      frameSampleCount: 3000,
      rendererSampleCount: 1200,
      gpuSampleCount: 1200,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons).toContain("Frame interval history reached its 3000-sample limit");
    expect(result.reasons.some((reason) => reason.startsWith("Frame history covers"))).toBe(true);
  });

  it("rejects frame samples from hidden or unfocused pages", () => {
    const result = validateBenchmarkMeasurement({
      requestedWalkMs: 12_000,
      wallElapsedMs: 12_030,
      frameDurationMs: 12_000,
      frameSampleCount: 12,
      rendererSampleCount: 12,
      gpuSampleCount: 12,
      visibilityState: 'visible',
      pageHasFocus: false,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('Browser page did not have focus during the measurement');
  });

  it("creates and upgrades a versioned report without clearing existing counters", () => {
    const counters = ensurePerfCounters({ schemaVersion: 0, reactRenders: 4 });
    expect(counters.schemaVersion).toBe(4);
    expect(counters.reactRenders).toBe(4);
    expect(counters.frameIntervalsMs).toEqual([]);
    expect(counters).toMatchObject({
      diagnosticsEnabled: false,
      environment: {},
      settings: {},
      resourceCounts: {},
      resourceSamples: [],
      resourceSampleCursor: 0,
      unavailableMeasurements: [],
      rendererFrames: [],
      gpuFrameTimesMs: [],
      gpuTimer: { supported: false },
    });
    expect(createPerfCounters().timeline).toEqual([]);
  });

  it("keeps first lifecycle marks and bounds timing and frame histories", () => {
    const counters = createPerfCounters();
    appendPerfMark(counters, "terrain-ready", { source: "fixture" });
    const firstMark = counters.marks["terrain-ready"];
    appendPerfMark(counters, "terrain-ready", { source: "late" });
    expect(counters.marks["terrain-ready"]).toEqual(firstMark);

    for (let i = 0; i <= PERF_TIMING_LIMIT; i++) appendPerfTiming(counters, "sample", i);
    expect(counters.timeline).toHaveLength(PERF_TIMING_LIMIT);
    expect(orderedPerfTimeline(counters)[0].durationMs).toBe(1);

    for (let i = 0; i <= PERF_FRAME_LIMIT; i++) appendFrameInterval(counters, i + 1);
    expect(counters.frameIntervalsMs).toHaveLength(PERF_FRAME_LIMIT);
    expect(orderedFrameIntervals(counters)[0]).toBe(2);
  });

  it("retains startup timing events through a full measurement-sized render burst", () => {
    const counters = createPerfCounters();
    appendPerfTiming(counters, "city.spawn-assembly-total", 1600, { elements: 4524 });
    for (let i = 0; i < PERF_FRAME_LIMIT; i++) {
      appendPerfTiming(counters, "renderer.postfx-cpu-submit", 1);
    }

    const timeline = orderedPerfTimeline(counters);
    expect(timeline).toHaveLength(PERF_FRAME_LIMIT + 1);
    expect(timeline[0]).toMatchObject({ name: "city.spawn-assembly-total", durationMs: 1600 });
    expect(counters.timelineCursor).toBe(0);
  });

  it("summarizes frame percentiles and low-FPS using slowest one percent", () => {
    expect(summarizeFrameIntervals([10, 20, 30, 40, 60, 120])).toMatchObject({
      sampleCount: 6,
      durationMs: 280,
      p50FrameTimeMs: 30,
      p95FrameTimeMs: 120,
      p99FrameTimeMs: 120,
      onePercentLowFps: 1000 / 120,
      framesOver50Ms: 2,
      framesOver100Ms: 1,
    });
    expect(summarizeFrameIntervals([]).sampleCount).toBe(0);
  });

  it("keeps renderer and GPU histories bounded and summarizes them", () => {
    const counters = createPerfCounters();
    for (let i = 0; i <= PERF_RENDERER_LIMIT; i++) {
      appendRendererFrame(counters, { calls: i, triangles: i * 3, lines: i * 2, points: i });
    }
    for (let i = 0; i <= PERF_GPU_TIME_LIMIT; i++) appendGpuFrameTime(counters, i / 10);

    expect(counters.rendererFrames).toHaveLength(PERF_RENDERER_LIMIT);
    expect(orderedRendererFrames(counters)[0].calls).toBe(1);
    expect(counters.gpuFrameTimesMs).toHaveLength(PERF_GPU_TIME_LIMIT);
    expect(orderedGpuFrameTimes(counters)[0]).toBe(0.1);
    expect(summarizeRendererFrames(orderedRendererFrames(counters))).toMatchObject({
      sampleCount: PERF_RENDERER_LIMIT,
      calls: { total: (PERF_RENDERER_LIMIT * (PERF_RENDERER_LIMIT + 1)) / 2 },
    });
    expect(summarizeDurationSamples([1, 2, 4])).toMatchObject({ sampleCount: 3, meanMs: 7 / 3, p95Ms: 4 });
  });

  it("orders a wrapped resource sample ring oldest-first", () => {
    const counters = {
      resourceSamples: Array.from({ length: PERF_RESOURCE_SAMPLE_LIMIT }, (_, index) => ({ atMs: index, geometries: index })),
      resourceSampleCursor: 2,
    };
    const samples = orderedResourceSamples(counters);
    expect(samples).toHaveLength(PERF_RESOURCE_SAMPLE_LIMIT);
    expect(samples[0].geometries).toBe(2);
    expect(samples.at(-1).geometries).toBe(1);
  });

  it("validates resource-soak coverage and summarizes one-minute stability windows", () => {
    const samples = Array.from({ length: 900 }, (_, index) => ({
      atMs: 10_000 + index * 1000,
      geometries: index < 120 ? 100 + index : 220,
      textures: 30,
      programs: 28,
    }));
    const validation = validateResourceSoak({
      requestedWalkMs: 900_000,
      wallElapsedMs: 900_000,
      resourceSamples: samples,
      movementPathMeters: 900,
      visibilityState: "visible",
      pageHasFocus: true,
    });
    expect(validation).toMatchObject({ valid: true, sampleCount: 900, expectedSampleCount: 675, maxSampleGapMs: 1000 });

    const stability = summarizeResourceStability(samples, { startAtMs: 10_000, durationMs: 900_013 });
    expect(stability.windows).toHaveLength(15);
    expect(stability.windows[0].counts.geometries.max).toBe(159);
    expect(stability.windows.at(-1).counts.geometries).toEqual({ first: 220, last: 220, min: 220, max: 220 });
  });

  it("rejects resource soaks with hidden pages or gaps in sampling", () => {
    const result = validateResourceSoak({
      requestedWalkMs: 900_000,
      wallElapsedMs: 900_000,
      resourceSamples: [{ atMs: 1000 }, { atMs: 7000 }],
      visibilityState: "hidden",
      pageHasFocus: false,
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("Page visibility was hidden during the soak");
    expect(result.reasons).toContain("Browser page did not have focus during the soak");
    expect(result.reasons).toContain("Resource sample gap reached 6000ms");
    expect(result.reasons).toContain("Walk covered 0.0m; at least 450.0m is required");
  });
});

function makeFakeWebGl({ extension = true } = {}) {
  let active = null;
  let disjoint = false;
  let nextId = 1;
  const queries = [];
  const deleted = [];
  const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
  const gl = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    createQuery() {
      const query = { id: nextId++, available: false, result: 0 };
      queries.push(query);
      return query;
    },
    beginQuery(_target, query) { active = query; },
    endQuery() { active = null; },
    getExtension(name) { return name === "EXT_disjoint_timer_query_webgl2" && extension ? ext : null; },
    getParameter(name) { return name === ext.GPU_DISJOINT_EXT && disjoint; },
    getQueryParameter(query, name) {
      if (name === this.QUERY_RESULT_AVAILABLE) return query.available;
      if (name === this.QUERY_RESULT) {
        if (!query.available) throw new Error("GPU result read before availability");
        return query.result;
      }
      throw new Error(`Unexpected query parameter ${name}`);
    },
    deleteQuery(query) { deleted.push(query); },
    setDisjoint(value) { disjoint = value; },
    get queries() { return queries; },
    get deleted() { return deleted; },
    get active() { return active; },
  };
  return gl;
}

describe("asynchronous WebGL GPU frame timer", () => {
  it("reads results only after a later availability poll and converts nanoseconds to milliseconds", () => {
    const gl = makeFakeWebGl();
    const samples = [];
    const timer = createGpuFrameTimer(gl, { onSample: (sample) => samples.push(sample) });
    expect(timer.supported).toBe(true);
    expect(timer.beginFrame()).toBe(true);
    expect(gl.active).toBe(gl.queries[0]);
    timer.endFrame();
    expect(samples).toEqual([]);

    gl.queries[0].available = true;
    gl.queries[0].result = 2_500_000;
    timer.beginFrame();
    expect(samples).toEqual([2.5]);
    timer.endFrame();
    timer.dispose();
    expect(gl.deleted).toContain(gl.queries[0]);
  });

  it("drops and deletes pending queries when the GPU reports disjoint timing", () => {
    const gl = makeFakeWebGl();
    const samples = [];
    const timer = createGpuFrameTimer(gl, { onSample: (sample) => samples.push(sample) });
    timer.beginFrame();
    timer.endFrame();
    gl.setDisjoint(true);
    timer.poll();
    expect(samples).toEqual([]);
    expect(gl.deleted).toContain(gl.queries[0]);
    expect(timer.snapshot().disjointSamples).toBe(1);
    timer.dispose();
  });

  it("reports unsupported extensions and bounds outstanding query count", () => {
    const unsupported = createGpuFrameTimer(makeFakeWebGl({ extension: false }));
    expect(unsupported.supported).toBe(false);
    expect(unsupported.snapshot().reason).toContain("unavailable");
    expect(unsupported.beginFrame()).toBe(false);

    const gl = makeFakeWebGl();
    const timer = createGpuFrameTimer(gl, { maxPendingQueries: 1 });
    timer.beginFrame();
    timer.endFrame();
    expect(timer.beginFrame()).toBe(false);
    expect(timer.snapshot().skippedForCapacity).toBe(1);
    timer.dispose();
    expect(gl.deleted).toContain(gl.queries[0]);
  });
});
