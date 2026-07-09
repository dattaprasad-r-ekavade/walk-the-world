// Facade atlas + per-floor UV remap (plan 17.5).
// Atlas V layout (bottom → top):
//   0.00–0.22  storefront (glass + door)
//   0.22–1.00  repeating upper-floor window bands
import * as THREE from "three";

const FLOOR_H = 3.2;
const STORE_V0 = 0;
const STORE_V1 = 0.22;
const WIN_V0 = 0.22;

/**
 * Procedural facade atlas. U wraps along the wall; V selects floor band.
 * Callers must remap ExtrudeGeometry UVs via remapWallUVs().
 */
export function makeFacadeAtlas() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d");

  // ---- upper floors (windows) ----
  g.fillStyle = "#f2eee6";
  g.fillRect(0, 0, 128, Math.floor(256 * (1 - WIN_V0)));
  const winTop = Math.floor(256 * (1 - WIN_V0));
  g.fillStyle = "rgba(40,55,80,0.88)";
  for (let y = 8; y < winTop - 8; y += 28) {
    for (let x = 8; x < 128; x += 24) {
      g.fillRect(x, y, 13, 16);
      g.fillStyle = "rgba(130,160,200,0.85)";
      g.fillRect(x + 1, y + 1, 5, 6);
      g.fillStyle = "rgba(40,55,80,0.88)";
    }
  }

  // ---- storefront band (bottom of atlas = high canvas Y) ----
  const storeH = Math.floor(256 * STORE_V1);
  const sy = 256 - storeH;
  g.fillStyle = "#2a3340";
  g.fillRect(0, sy, 128, storeH);
  // large glass panes
  g.fillStyle = "rgba(90,140,190,0.92)";
  g.fillRect(6, sy + 8, 36, storeH - 16);
  g.fillRect(48, sy + 8, 36, storeH - 16);
  g.fillStyle = "rgba(180,210,235,0.55)";
  g.fillRect(8, sy + 10, 12, 14);
  g.fillRect(50, sy + 10, 12, 14);
  // door
  g.fillStyle = "#3a2a1e";
  g.fillRect(92, sy + 10, 28, storeH - 14);
  g.fillStyle = "#c9a84a";
  g.fillRect(114, sy + storeH * 0.45, 3, 6);
  // awning stripe hint
  g.fillStyle = "#b8433a";
  g.fillRect(0, sy, 128, 5);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 1);
  t.flipY = true;
  return t;
}

/** Night emissive atlas matching facade bands (upper windows only). */
export function makeLitWindowAtlas() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#000000";
  g.fillRect(0, 0, 128, 256);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const winTop = Math.floor(256 * (1 - WIN_V0));
  for (let y = 8; y < winTop - 8; y += 28) {
    for (let x = 8; x < 128; x += 24) {
      if (rnd() < 0.42) {
        g.fillStyle = rnd() < 0.7 ? "#ffd98a" : "#cfe4ff";
        g.fillRect(x, y, 13, 16);
      }
    }
  }
  // soft storefront glow
  const storeH = Math.floor(256 * STORE_V1);
  const sy = 256 - storeH;
  g.fillStyle = "rgba(255,220,140,0.35)";
  g.fillRect(6, sy + 8, 78, storeH - 16);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(1, 1);
  t.flipY = true;
  return t;
}

export function wantsStorefront(tags) {
  const b = String(tags?.building || "").toLowerCase();
  if (/^(retail|commercial|shop|supermarket|mall|kiosk|office)$/.test(b)) return true;
  if (tags?.shop || tags?.amenity === "restaurant" || tags?.amenity === "cafe") return true;
  return false;
}

/**
 * Remap wall UVs to per-floor atlas bands.
 * @param {THREE.BufferGeometry} wallGeo
 * @param {{ base: number, height: number, shopfront?: boolean, seed?: number }} opts
 *   base = ExtrudeGeometry base Y (already sunk); street ≈ base+4
 */
export function remapWallUVs(wallGeo, { base, height, shopfront = false, seed = 1 }) {
  const pos = wallGeo.attributes.position;
  if (!pos) return;
  const streetY = base + 4;
  const floors = Math.max(1, Math.round(height / FLOOR_H) || 1);
  const uScale = 0.12; // ~8 m per U tile along wall
  const uv = new Float32Array(pos.count * 2);
  const jitter = ((seed % 17) / 17) * 0.35;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // horizontal: project onto dominant wall axis via world XZ
    const u = (x + z) * uScale + jitter;
    const rel = y - streetY;
    let v;
    if (shopfront && rel < FLOOR_H + 0.15) {
      const t = Math.max(0, Math.min(1, rel / FLOOR_H));
      v = STORE_V0 + t * (STORE_V1 - STORE_V0);
    } else {
      const fi = Math.max(0, Math.floor(rel / FLOOR_H));
      const ft = Math.max(0, Math.min(1, (rel - fi * FLOOR_H) / FLOOR_H));
      // cycle through 3 upper-floor bands in the window region
      const band = (fi + (shopfront ? 0 : 0)) % 3;
      const bandH = (1 - WIN_V0) / 3;
      v = WIN_V0 + band * bandH + ft * bandH * 0.92;
    }
    // buried skirt below street → dark storefront bottom
    if (rel < -0.2) v = STORE_V0;
    // roof cap region → top of window band
    if (rel > floors * FLOOR_H + 0.5) v = 0.95;
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  wallGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

export { FLOOR_H, STORE_V0, STORE_V1, WIN_V0 };
