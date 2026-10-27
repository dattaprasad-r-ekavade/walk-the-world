export const DESKTOP_ASSEMBLY_BUDGET_MS = 8;
export const MOBILE_ASSEMBLY_BUDGET_MS = 12;

export function isMobileAssemblyDevice(environment = globalThis) {
  const nav = environment.navigator || (typeof navigator !== "undefined" ? navigator : null);
  const win = environment.window || (typeof window !== "undefined" ? window : null);

  if (typeof nav?.userAgentData?.mobile === "boolean") return nav.userAgentData.mobile;
  if (/iPad|iPhone|iPod|Android|Mobile/i.test(nav?.userAgent || "")) return true;

  const coarsePointer = win?.matchMedia?.("(pointer: coarse)")?.matches === true;
  return coarsePointer && (nav?.maxTouchPoints || 0) > 0;
}

export function resolveAssemblyBudgetMs({ budgetMs, mobile } = {}) {
  if (Number.isFinite(budgetMs) && budgetMs > 0) return budgetMs;
  const isMobile = typeof mobile === "boolean" ? mobile : isMobileAssemblyDevice();
  return isMobile ? MOBILE_ASSEMBLY_BUDGET_MS : DESKTOP_ASSEMBLY_BUDGET_MS;
}

export function createAssemblyBudgetScheduler({
  budgetMs = resolveAssemblyBudgetMs(),
  signal,
  now = () => performance.now(),
  yieldToHost = () => new Promise((resolve) => setTimeout(resolve, 0)),
  onSlice = () => {},
} = {}) {
  const targetMs = resolveAssemblyBudgetMs({ budgetMs });
  const yieldThresholdMs = targetMs * 0.75;
  let sliceStartedAt = now();
  let sliceIndex = 0;
  let operationCount = 0;
  let stages = new Set();
  let yieldCount = 0;
  let finished = false;

  const recordSlice = (durationMs, { yielded, asyncWait = false, failed = false }) => {
    if (operationCount === 0 && durationMs <= 0) return;
    onSlice({
      durationMs: Math.max(0, durationMs),
      details: {
        budgetMs: targetMs,
        yieldThresholdMs,
        chunkIndex: sliceIndex++,
        operationCount,
        stages: [...stages],
        yielded,
        asyncWait,
        overBudget: durationMs > targetMs,
        failed,
      },
    });
    operationCount = 0;
    stages = new Set();
  };

  function checkpoint(stage) {
    signal?.throwIfAborted();
    if (finished) return null;
    operationCount++;
    if (stage) stages.add(stage);

    const durationMs = now() - sliceStartedAt;
    if (durationMs < yieldThresholdMs) return null;

    yieldCount++;
    recordSlice(durationMs, { yielded: true });
    return Promise.resolve(yieldToHost()).then(() => {
      sliceStartedAt = now();
      signal?.throwIfAborted();
    }, (error) => {
      sliceStartedAt = now();
      throw error;
    });
  }

  function waitForHost(promise, stage) {
    signal?.throwIfAborted();
    if (finished) return Promise.resolve(promise);
    operationCount++;
    if (stage) stages.add(stage);
    yieldCount++;
    recordSlice(now() - sliceStartedAt, { yielded: true, asyncWait: true });
    return Promise.resolve(promise).then((value) => {
      sliceStartedAt = now();
      signal?.throwIfAborted();
      return value;
    }, (error) => {
      sliceStartedAt = now();
      throw error;
    });
  }

  function finish({ failed = false } = {}) {
    if (finished) return;
    finished = true;
    recordSlice(now() - sliceStartedAt, { yielded: false, asyncWait: false, failed });
  }

  return {
    budgetMs: targetMs,
    yieldThresholdMs,
    checkpoint,
    finish,
    waitForHost,
    get yieldCount() { return yieldCount; },
  };
}
