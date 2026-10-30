// Procedural CanvasTextures for the street engine (no downloads).
import * as THREE from "three";
import { createSeededRandom } from "./random";

/** Shared one-metre concrete paving slabs with subtle grout and deterministic grain. */
export function makeSidewalkTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const random = createSeededRandom("sidewalk-pavers:v1");
  const shades = ["#929087", "#8d8b83", "#96948b", "#908e85"];
  for (let y = 0; y < 128; y += 64) {
    for (let x = 0; x < 128; x += 64) {
      g.fillStyle = shades[(random() * shades.length) | 0];
      g.fillRect(x, y, 64, 64);
      for (let i = 0; i < 24; i++) {
        const value = random() < 0.5 ? "0,0,0" : "255,255,255";
        const alpha = 0.025 + random() * 0.04;
        g.fillStyle = `rgba(${value},${alpha})`;
        g.fillRect(x + random() * 64, y + random() * 64, 2 + random() * 4, 1 + random() * 3);
      }
    }
  }
  // 2 m texture repeat × 2 slabs per axis = 1 m pavers.
  g.strokeStyle = "rgba(45,44,40,0.45)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(64, 0); g.lineTo(64, 128);
  g.moveTo(0, 64); g.lineTo(128, 64);
  g.stroke();
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Mown-grass albedo for parks and pitches: mottled blades over a mid-green
 * base. The material tints it per kind, so keep it close to neutral green.
 */
export function makeGrassTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const random = createSeededRandom("ground-grass:v1");
  g.fillStyle = "#c9d6bf";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) {
    const light = random() < 0.5;
    g.fillStyle = light ? `rgba(255,255,235,${0.05 + random() * 0.06})` : `rgba(20,45,10,${0.05 + random() * 0.08})`;
    g.beginPath();
    g.ellipse(random() * 128, random() * 128, 4 + random() * 10, 3 + random() * 7, random() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = random() < 0.5 ? "rgba(30,60,15,0.18)" : "rgba(255,255,220,0.14)";
    g.fillRect(random() * 128, random() * 128, 1, 2 + random() * 2);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Proper asphalt albedo (U = across width, V = along road in meters via UV).
 * @param {'arterial'|'residential'|'plain'|'path'} kind
 */
export function makeRoadTexture(kind = "plain", profile = {}) {
  const mode = typeof kind === "boolean" ? (kind ? "arterial" : "plain") : kind;
  const W = 128;
  const H = 256; // longer V so dashes don't stretch
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");

  // Lift the asphalt base enough for road shapes to survive night ambient fill.
  const base = mode === "path" ? "#8a7e62" : "#4a4f57";
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

  const lanes = Math.max(0, Math.min(8, Math.round(Number(profile.lanes) || 0)));
  const oneWay = profile.oneWay === true;
  const markWidth = 2;
  const dashed = (x, color, dash, gap) => {
    g.fillStyle = color;
    for (let y = 6; y < H; y += dash + gap) g.fillRect(x - markWidth / 2, y, markWidth, dash);
  };

  if (mode !== "path") {
    if (mode === "arterial" || lanes > 2 || oneWay) {
      // Edge lines help wide roads stay legible and outline one-way corridors.
      g.fillStyle = "rgba(245,245,240,0.92)";
      g.fillRect(4, 0, markWidth, H);
      g.fillRect(W - 6, 0, markWidth, H);
    }

    if (lanes > 1) {
      for (let boundary = 1; boundary < lanes; boundary++) {
        const x = Math.round(W * boundary / lanes);
        const isCenter = !oneWay && lanes % 2 === 0 && boundary === lanes / 2;
        const centerColor = mode === "arterial"
          ? "rgba(255,210,70,0.95)"
          : "rgba(245,245,240,0.92)";
        dashed(x, isCenter ? centerColor : "rgba(245,245,240,0.9)", 24, 48);
      }
    } else if (lanes === 0 && (mode === "arterial" || mode === "residential")) {
      // Preserve sensible class defaults where OSM has no lane metadata.
      const centerColor = mode === "arterial"
        ? "rgba(255,210,70,0.95)"
        : "rgba(245,245,240,0.9)";
      dashed(W / 2, centerColor, mode === "arterial" ? 32 : 24, mode === "arterial" ? 64 : 48);
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  // V: one texture height ≈ 24 m of road (matches arc-length UVs).
  t.repeat.set(1, 1 / 24);
  return t;
}

export // Railway track: gravel bed + brown sleepers + two steel rails.
function makeRailTexture() {
  const random = createSeededRandom("rail-ballast:v1");
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#6b675f"; // ballast gravel
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(0,0,0,${random() * 0.15})`;
    g.fillRect(random() * 64, random() * 64, 2, 2);
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
