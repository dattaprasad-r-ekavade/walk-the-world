/**
 * Pure decision logic for the dynamic render-scale governor.
 * Scale is a multiplier (0..1) applied to the tier's base pixel ratio.
 */
export const RENDER_SCALE_DEFAULTS = Object.freeze({
  floor: 0.6,
  max: 1,
  downStep: 0.1,
  upStep: 0.05,
  overWindows: 2,
  underWindows: 4,
  underFactor: 0.75,
});

/** Frame-time target (ms) per quality tier. */
export function renderScaleTargetMs(quality) {
  return quality === "low" ? 1000 / 30 : 1000 / 60;
}

export function createRenderScaleState(scale = 1) {
  return { scale, over: 0, under: 0 };
}

/** p90 of the first `count` samples; sorts `samples` in place. */
export function p90Of(samples, count = samples.length) {
  if (!count) return 0;
  const view = samples.subarray ? samples.subarray(0, count) : samples.slice(0, count);
  view.sort();
  return view[Math.max(0, Math.ceil(count * 0.9) - 1)];
}

/**
 * @param {{scale:number, over:number, under:number}} state
 * @param {number} p90Ms
 * @param {number} targetMs
 * @param {object} [opts]
 * @returns {{scale:number, over:number, under:number}} new state (input not mutated)
 */
export function stepRenderScale(state, p90Ms, targetMs, opts = {}) {
  const o = { ...RENDER_SCALE_DEFAULTS, ...opts };
  if (!Number.isFinite(p90Ms) || p90Ms <= 0) return { ...state };
  let { scale, over, under } = state;
  if (p90Ms > targetMs) {
    over += 1;
    under = 0;
    if (over >= o.overWindows) {
      scale = Math.max(o.floor, scale - o.downStep);
      over = 0;
    }
  } else if (p90Ms < targetMs * o.underFactor) {
    under += 1;
    over = 0;
    if (under >= o.underWindows) {
      scale = Math.min(o.max, scale + o.upStep);
      under = 0;
    }
  } else {
    over = 0;
    under = 0;
  }
  scale = Math.round(scale * 1000) / 1000;
  return { scale, over, under };
}

export function isAtRenderScaleFloor(scale, floor = RENDER_SCALE_DEFAULTS.floor) {
  return scale <= floor + 1e-6;
}
