export function createTouchState() {
  return {
    active: false,
    moveX: 0,
    moveY: 0,
    lookDX: 0,
    lookDY: 0,
    sprint: false,
  };
}

export const touchInputRef = { current: null };

export function readTouchMovement(touch) {
  if (!touch?.active) return { f: 0, r: 0, sprint: false };
  const dead = 0.12;
  const mx = Math.abs(touch.moveX) < dead ? 0 : touch.moveX;
  const my = Math.abs(touch.moveY) < dead ? 0 : touch.moveY;
  return { f: my, r: mx, sprint: !!touch.sprint };
}

export function applyTouchLook(touch, player, scale = 1, opts = {}) {
  if (!touch?.active) return;
  // Driving: A/D (or left stick X) steers — look stick only pitches chase cam
  if (!opts.driving && touch.lookDX) player.heading += touch.lookDX * scale;
  if (touch.lookDY) {
    const lo = opts.driving ? -0.35 : -1.45;
    const hi = opts.driving ? 0.45 : 1.45;
    player.pitch = Math.max(
      lo,
      Math.min(hi, player.pitch - touch.lookDY * scale)
    );
  }
  touch.lookDX = 0;
  touch.lookDY = 0;
}
