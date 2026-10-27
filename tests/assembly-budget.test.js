import { describe, expect, it, vi } from "vitest";
import {
  createAssemblyBudgetScheduler,
  isMobileAssemblyDevice,
  resolveAssemblyBudgetMs,
} from "@/lib/engine/street/assembly-budget";

describe("time-budgeted city assembly", () => {
  it("uses the planned desktop and mobile slice budgets", () => {
    expect(resolveAssemblyBudgetMs({ mobile: false })).toBe(8);
    expect(resolveAssemblyBudgetMs({ mobile: true })).toBe(12);
    expect(resolveAssemblyBudgetMs({ budgetMs: 5, mobile: false })).toBe(5);
  });

  it("detects mobile devices from platform hints and touch pointers", () => {
    expect(isMobileAssemblyDevice({ navigator: { userAgentData: { mobile: true } } })).toBe(true);
    expect(isMobileAssemblyDevice({
      navigator: { maxTouchPoints: 5 },
      window: { matchMedia: () => ({ matches: true }) },
    })).toBe(true);
    expect(isMobileAssemblyDevice({
      navigator: { maxTouchPoints: 0, userAgent: "Desktop Chrome" },
      window: { matchMedia: () => ({ matches: false }) },
    })).toBe(false);
  });

  it("yields early to leave room for checkpoint work within the target budget", async () => {
    let time = 0;
    const onSlice = vi.fn();
    const yieldToHost = vi.fn(() => Promise.resolve());
    const scheduler = createAssemblyBudgetScheduler({
      budgetMs: 8,
      now: () => time,
      yieldToHost,
      onSlice,
    });

    time = 5;
    expect(scheduler.checkpoint("walls")).toBeNull();
    expect(yieldToHost).not.toHaveBeenCalled();

    time = 7;
    await scheduler.checkpoint("roof-caps");
    expect(yieldToHost).toHaveBeenCalledOnce();
    expect(onSlice).toHaveBeenNthCalledWith(1, {
      durationMs: 7,
      details: {
        budgetMs: 8,
        yieldThresholdMs: 6,
        chunkIndex: 0,
        operationCount: 2,
        stages: ["walls", "roof-caps"],
        yielded: true,
        asyncWait: false,
        overBudget: false,
        failed: false,
      },
    });

    time = 10;
    scheduler.finish();
    expect(onSlice).toHaveBeenNthCalledWith(2, {
      durationMs: 3,
      details: {
        budgetMs: 8,
        yieldThresholdMs: 6,
        chunkIndex: 1,
        operationCount: 0,
        stages: [],
        yielded: false,
        asyncWait: false,
        overBudget: false,
        failed: false,
      },
    });
  });

  it("excludes an awaited host operation from synchronous slice duration", async () => {
    let time = 0;
    const onSlice = vi.fn();
    const scheduler = createAssemblyBudgetScheduler({
      budgetMs: 8,
      now: () => time,
      onSlice,
    });
    time = 3;
    await scheduler.waitForHost(Promise.resolve().then(() => { time = 103; }), "font-load");
    time = 107;
    scheduler.finish();
    expect(onSlice).toHaveBeenNthCalledWith(1, {
      durationMs: 3,
      details: {
        budgetMs: 8,
        yieldThresholdMs: 6,
        chunkIndex: 0,
        operationCount: 1,
        stages: ["font-load"],
        yielded: true,
        asyncWait: true,
        overBudget: false,
        failed: false,
      },
    });
    expect(onSlice.mock.calls[1][0].durationMs).toBe(4);
    expect(onSlice.mock.calls[1][0].details.asyncWait).toBe(false);
  });

  it("checks cancellation before work and after returning to the host", async () => {
    const before = new AbortController();
    before.abort(new Error("cancel before work"));
    const beforeScheduler = createAssemblyBudgetScheduler({
      signal: before.signal,
      now: () => 20,
    });
    expect(() => beforeScheduler.checkpoint("walls")).toThrow("cancel before work");

    const after = new AbortController();
    let afterTime = 0;
    const afterScheduler = createAssemblyBudgetScheduler({
      budgetMs: 1,
      signal: after.signal,
      now: () => afterTime,
      yieldToHost: () => {
        after.abort(new Error("cancel during yield"));
        return Promise.resolve();
      },
    });
    afterTime = 2;
    await expect(afterScheduler.checkpoint("walls")).rejects.toThrow("cancel during yield");
  });
});
