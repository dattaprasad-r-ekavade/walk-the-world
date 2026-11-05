import { createRenderScaleState, isAtRenderScaleFloor, p90Of, renderScaleTargetMs, stepRenderScale } from "@/lib/engine/render-scale";

const STEP_DOWN = { high: "medium", medium: "low" };
const STEP_UP = { low: "medium", medium: "high" };

/**
 * Protects frame pacing in two layers, sampled once a second:
 *
 * 1. The render-scale governor nudges the pixel ratio between 0.6x and 1x
 *    from the p90 frame time of the last window.
 * 2. In auto quality mode, the preset steps down after 3 consecutive slow
 *    seconds (< 30 fps) once render scale has bottomed out, and steps up after
 *    12 consecutive fast seconds (>= 52 fps). Changes are at least 2.5 s apart
 *    so a one-off streamed cell does not cause visible preset thrashing.
 *
 * Pure state machine: no renderer, store or DOM access.
 */
export function createQualityGovernor({ initialScale = 1, governorEnabled = true, now = 0 } = {}) {
  const frameWindow = new Float32Array(256);
  let frameCount = 0;
  let scaleState = createRenderScaleState(initialScale);
  let lowStreak = 0;
  let goodStreak = 0;
  let lastPresetChange = now;

  return {
    get scale() { return scaleState.scale; },

    /** Starts over at a new base scale (quality preset changed). */
    reset(scale) {
      scaleState = createRenderScaleState(scale);
      frameCount = 0;
    },

    /** Records one visible frame interval. */
    addFrame(intervalMs) {
      if (frameCount < frameWindow.length) frameWindow[frameCount++] = intervalMs;
    },

    /**
     * Once-a-second evaluation.
     * @returns {{ scaleChanged: boolean, nextTier: string | null }}
     */
    evaluate({ fps, tier, autoPresets, now: at }) {
      let scaleChanged = false;
      if (governorEnabled && frameCount >= 20) {
        const next = stepRenderScale(scaleState, p90Of(frameWindow, frameCount), renderScaleTargetMs(tier));
        scaleChanged = next.scale !== scaleState.scale;
        scaleState = next;
      }
      frameCount = 0;
      if (!autoPresets) return { scaleChanged, nextTier: null };

      if (fps > 0 && fps < 30) {
        lowStreak += 1;
        goodStreak = 0;
      } else if (fps >= 52) {
        goodStreak += 1;
        lowStreak = 0;
      } else {
        lowStreak = 0;
        goodStreak = 0;
      }
      const scaleExhausted = !governorEnabled || isAtRenderScaleFloor(scaleState.scale);
      const candidate = lowStreak >= 3 && scaleExhausted
        ? STEP_DOWN[tier] || tier
        : goodStreak >= 12
          ? STEP_UP[tier] || tier
          : tier;
      if (candidate === tier || at - lastPresetChange <= 2500) return { scaleChanged, nextTier: null };
      lowStreak = 0;
      goodStreak = 0;
      lastPresetChange = at;
      return { scaleChanged, nextTier: candidate };
    },
  };
}

/** Population caps per quality tier. */
export function populationBudget(tier) {
  if (tier === "low") return { maxPeds: 52, maxCars: 24, maxBirds: 12 };
  if (tier === "medium") return { maxPeds: 96, maxCars: 48, maxBirds: 24 };
  return { maxPeds: 140, maxCars: 70, maxBirds: 36 };
}

/** Seconds between population updates: every frame on high, 30 Hz medium, 20 Hz low. */
export function populationStep(tier) {
  return tier === "high" ? 0 : tier === "medium" ? 1 / 30 : 1 / 20;
}

/** Base device pixel ratio for a quality preset. */
export function basePixelRatioFor(tier, devicePixelRatio = 1) {
  if (tier === "low") return 0.75;
  return Math.min(devicePixelRatio || 1, tier === "medium" ? 1.25 : 1.5);
}

/** Shadow map edge length for a quality preset. */
export function shadowMapSizeFor(tier) {
  return tier === "low" ? 512 : tier === "medium" ? 1024 : 2048;
}
