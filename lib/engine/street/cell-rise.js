// Pure math for the neighbour-cell "rise from the ground" animation.
export const RISE_MS = 600;
export const RISE_MIN_SCALE = 0.02;

/** Ease-out cubic of linear progress t in [0,1]. */
export function easeOutCubic(t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  const u = 1 - c;
  return 1 - u * u * u;
}

/** Linear progress for elapsed ms, clamped to [0,1]. */
export function riseProgress(elapsedMs, durationMs = RISE_MS) {
  if (!(durationMs > 0)) return 1;
  return elapsedMs <= 0 ? 0 : Math.min(1, elapsedMs / durationMs);
}

/** scale.y for elapsed ms (RISE_MIN_SCALE -> 1). */
export function riseScale(elapsedMs, durationMs = RISE_MS) {
  return RISE_MIN_SCALE + (1 - RISE_MIN_SCALE) * easeOutCubic(riseProgress(elapsedMs, durationMs));
}

/** position.y that keeps world height `pivotY` fixed while scale.y = s. */
export function risePivotOffset(pivotY, s) {
  return pivotY * (1 - s);
}
