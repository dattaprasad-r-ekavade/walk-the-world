// Per-frame player movement helpers. Pure functions over plain objects so the
// walk/drive/camera rules can be tested without a renderer.

/** Forward/right input (-1..1 each) from keyboard state plus touch movement. */
export function readMoveAxes(keys, touchMovement) {
  let f = touchMovement?.f || 0;
  let r = touchMovement?.r || 0;
  if (keys.KeyW || keys.ArrowUp) f += 1;
  if (keys.KeyS || keys.ArrowDown) f -= 1;
  if (keys.KeyD || keys.ArrowRight) r += 1;
  if (keys.KeyA || keys.ArrowLeft) r -= 1;
  return { f, r };
}

/**
 * Walks `player` by `distance` metres along the input, sliding along walls.
 * The collision probe is padded 0.45 m along the motion so the camera's near
 * plane never pokes through a wall before collision triggers.
 * @returns {number} metres actually moved
 */
export function stepWalk(player, f, r, distance, insideBuilding) {
  const sin = Math.sin(player.heading), cos = Math.cos(player.heading);
  const dx = (f * sin + r * cos) * distance;
  const dz = (-f * cos + r * sin) * distance;
  const len = Math.hypot(dx, dz) || 1;
  const padX = (dx / len) * 0.45, padZ = (dz / len) * 0.45;
  const blocked = (x, z) => insideBuilding(x + padX, z + padZ) || insideBuilding(x, z);
  const nx = player.x + dx, nz = player.z + dz;
  const ox = player.x, oz = player.z;
  if (!blocked(nx, nz)) { player.x = nx; player.z = nz; }
  else if (!blocked(player.x, nz)) player.z = nz;
  else if (!blocked(nx, player.z)) player.x = nx;
  return Math.hypot(player.x - ox, player.z - oz);
}

/** Free-fly step for the editor and photo cameras (WASD along the look, Space/C vertical). */
export function stepFly(fly, f, r, vertical, speed) {
  const sinH = Math.sin(fly.heading), cosH = Math.cos(fly.heading);
  const cosP = Math.cos(fly.pitch), sinP = Math.sin(fly.pitch);
  fly.x += (f * sinH * cosP + r * cosH) * speed;
  fly.z += (-f * cosH * cosP + r * sinH) * speed;
  fly.y += f * sinP * speed + vertical * speed;
}

function deckBounds(deck) {
  if (!deck.bb) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of deck.pts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < z0) z0 = p.y;
      if (p.y > z1) z1 = p.y;
    }
    deck.bb = { x0: x0 - deck.halfW, x1: x1 + deck.halfW, z0: z0 - deck.halfW, z1: z1 + deck.halfW };
  }
  return deck.bb;
}

/**
 * Standing height at (x, z): the terrain, or a bridge deck when the point is
 * on one and the deck is no more than 3 m below the terrain. Deck polylines
 * store (x, z) in `pts[i].x/y`; bounding boxes are cached on the deck.
 */
export function standingHeight(decks, x, z, terrainY) {
  let gy = terrainY;
  if (!decks) return gy;
  for (const deck of decks) {
    const bb = deckBounds(deck);
    if (x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue;
    const P = deck.pts;
    for (let i = 1; i < P.length; i++) {
      const ax = P[i - 1].x, az = P[i - 1].y, bx = P[i].x, bz = P[i].y;
      const abx = bx - ax, abz = bz - az;
      const l2 = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / l2));
      const qx = ax + abx * t, qz = az + abz * t;
      if (Math.hypot(x - qx, z - qz) < deck.halfW) {
        const along = (deck.cum[i - 1] + Math.sqrt(l2) * t) / deck.len;
        const deckY = deck.y0 + (deck.y1 - deck.y0) * along;
        if (deckY > gy - 3) gy = Math.max(gy, deckY);
        break;
      }
    }
  }
  return gy;
}

/**
 * Boom length for a chase camera behind (x, z): shortened up to three times
 * while the camera would sit inside a building.
 */
export function chaseBoom(x, z, dirX, dirZ, length, insideBuilding) {
  let back = length;
  for (let tries = 0; tries < 3 && insideBuilding(x - dirX * back, z - dirZ * back); tries++) back *= 0.55;
  return back;
}

/** Nearest point outside buildings on rings of growing radius, or null. */
export function nearestOpenSpot(x, z, insideBuilding) {
  if (!insideBuilding(x, z)) return { x, z };
  for (const radius of [12, 25, 45, 70, 100, 140]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const sx = x + Math.sin(a) * radius;
      const sz = z + Math.cos(a) * radius;
      if (!insideBuilding(sx, sz)) return { x: sx, z: sz };
    }
  }
  return null;
}
