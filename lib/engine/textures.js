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
  t.repeat.set(1 / 6, 1 / 6); // ~6 m per texture tile
  return t;
}

export // Asphalt with edge lines + dashed center line (u across road width).
function makeRoadTexture(withMarkings) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 64, 64);
  // asphalt noise
  for (let i = 0; i < 250; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }
  if (withMarkings) {
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.fillRect(2, 0, 3, 64); // edge lines
    g.fillRect(59, 0, 3, 64);
    g.fillStyle = "rgba(255,220,110,0.95)"; // yellow center dash
    g.fillRect(30, 4, 3, 26);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1 / 14); // one dash cycle ≈ 14 m along the road
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
  t.repeat.set(1, 1 / 2.6); // sleeper spacing ≈ real
  return t;
}
