// Procedural CanvasTextures for the street engine (no downloads).
import * as THREE from "three";

export // Procedural facade texture: base tint + darker window grid. UVs from
// ExtrudeGeometry are in meters, so texture.repeat sets real-world scale.
function makeFacadeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "rgba(40,55,80,0.85)"; // window glass
  for (let y = 10; y < 128; y += 32) {
    for (let x = 8; x < 128; x += 24) {
      g.fillRect(x, y, 13, 18);
      g.fillStyle = "rgba(120,150,190,0.9)";
      g.fillRect(x + 1, y + 1, 5, 7); // sky reflection corner
      g.fillStyle = "rgba(40,55,80,0.85)";
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / 6, 1 / 6); // ~6 m per texture tile
  return t;
}

/**
 * Proper asphalt albedo (U = across width, V = along road in meters via UV).
 * @param {'arterial'|'residential'|'plain'|'path'} kind
 */
export function makeRoadTexture(kind = "plain") {
  const mode = typeof kind === "boolean" ? (kind ? "arterial" : "plain") : kind;
  const W = 128;
  const H = 256; // longer V so dashes don't stretch
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");

  // Dark asphalt base (not white — material.color only tints slightly)
  const base = mode === "path" ? "#8a7e62" : "#3c4048";
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // Aggregate / wear noise
  let seed = mode === "path" ? 91 : 41;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2200; i++) {
    const a = rnd() * (mode === "path" ? 0.18 : 0.14);
    g.fillStyle =
      rnd() < 0.55
        ? `rgba(0,0,0,${a})`
        : `rgba(255,255,255,${a * 0.45})`;
    const s = 1 + (rnd() * 2) | 0;
    g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, s, s);
  }
  // Subtle longitudinal wear streaks
  if (mode !== "path") {
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(255,255,255,${0.015 + rnd() * 0.025})`;
      g.fillRect(8 + rnd() * (W - 16), 0, 1 + rnd() * 2, H);
    }
  }

  if (mode === "arterial") {
    // White edge lines
    g.fillStyle = "rgba(245,245,240,0.95)";
    g.fillRect(4, 0, 5, H);
    g.fillRect(W - 9, 0, 5, H);
    // Yellow dashed center
    g.fillStyle = "rgba(255,210,70,0.95)";
    const dash = 48;
    const gap = 36;
    for (let y = 8; y < H; y += dash + gap) {
      g.fillRect(W / 2 - 2, y, 4, dash);
    }
  } else if (mode === "residential") {
    // Single white dashed center (no yellow)
    g.fillStyle = "rgba(245,245,240,0.9)";
    const dash = 36;
    const gap = 28;
    for (let y = 6; y < H; y += dash + gap) {
      g.fillRect(W / 2 - 2, y, 3, dash);
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  // V: one texture height ≈ 12 m of road (matches arc-length UVs)
  t.repeat.set(1, 1 / 12);
  return t;
}

export // Railway track: gravel bed + brown sleepers + two steel rails.
function makeRailTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#6b675f"; // ballast gravel
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.15})`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  g.fillStyle = "#4a3a28"; // sleepers
  for (let y = 2; y < 64; y += 16) g.fillRect(8, y, 48, 6);
  g.fillStyle = "#c9ccd1"; // rails
  g.fillRect(18, 0, 3, 64);
  g.fillRect(43, 0, 3, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 1 / 2.6); // sleeper spacing ≈ real
  return t;
}

export // Night emissive map: same window grid as the facade, ~40% of windows
// glowing warm. Black elsewhere so only glass emits. Multiplied by
// emissiveIntensity, which the sky cycle raises after sunset.
function makeLitWindowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#000000";
  g.fillRect(0, 0, 128, 128);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 10; y < 128; y += 32) {
    for (let x = 8; x < 128; x += 24) {
      if (rnd() < 0.42) {
        g.fillStyle = rnd() < 0.7 ? "#ffd98a" : "#cfe4ff"; // warm / cool rooms
        g.fillRect(x, y, 13, 18);
      }
    }
  }
  const t2 = new THREE.CanvasTexture(c);
  t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
  t2.repeat.set(1 / 6, 1 / 6);
  return t2;
}
