import { describe, expect, it } from "vitest";
import {
  appendFrameInterval,
  appendPerfMark,
  appendPerfTiming,
  createPerfCounters,
  ensurePerfCounters,
  orderedFrameIntervals,
  orderedPerfTimeline,
  summarizeFrameIntervals,
  PERF_FRAME_LIMIT,
  PERF_TIMING_LIMIT,
} from "@/lib/perf";

describe("performance diagnostics", () => {
  it("creates and upgrades a versioned report without clearing existing counters", () => {
    const counters = ensurePerfCounters({ schemaVersion: 0, reactRenders: 4 });
    expect(counters.schemaVersion).toBe(1);
    expect(counters.reactRenders).toBe(4);
    expect(counters.frameIntervalsMs).toEqual([]);
    expect(counters).toMatchObject({
      diagnosticsEnabled: false,
      environment: {},
      settings: {},
      resourceCounts: {},
      unavailableMeasurements: [],
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
});
