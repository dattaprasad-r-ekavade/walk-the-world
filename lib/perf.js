// Lightweight perf counters — read by scripts/bench-perf.mjs via window.__perfCounters
export function getPerfCounters() {
  if (typeof window === 'undefined') return null;
  if (!window.__perfCounters) {
    window.__perfCounters = {
      reactRenders: 0,
      minimapDraws: 0,
      statusUpdates: 0,
      hudUpdates: 0,
      fpsSamples: [],
    };
  }
  return window.__perfCounters;
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

export function recordFpsSample(fps) {
  const c = getPerfCounters();
  if (c && fps > 0) c.fpsSamples.push(fps);
}
