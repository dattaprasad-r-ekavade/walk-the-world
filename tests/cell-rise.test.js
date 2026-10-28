import { describe, it, expect } from "vitest";
import { easeOutCubic, riseProgress, riseScale, risePivotOffset, RISE_MIN_SCALE, RISE_MS } from "@/lib/engine/street/cell-rise";

describe("cell-rise math", () => {
  it("clamps and eases out", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
  it("progress is clamped", () => {
    expect(riseProgress(-5)).toBe(0);
    expect(riseProgress(RISE_MS / 2)).toBeCloseTo(0.5);
    expect(riseProgress(RISE_MS * 3)).toBe(1);
    expect(riseProgress(10, 0)).toBe(1);
  });
  it("scale runs min -> 1 monotonically", () => {
    expect(riseScale(0)).toBeCloseTo(RISE_MIN_SCALE);
    expect(riseScale(RISE_MS)).toBe(1);
    expect(riseScale(200)).toBeLessThan(riseScale(300));
  });
  it("pivot offset vanishes at full scale", () => {
    expect(risePivotOffset(40, 1)).toBe(0);
    expect(risePivotOffset(40, 0.5)).toBe(20);
  });
});
