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
// Shared atlas grid so albedo + night-emissive windows always line up.
// 4x the old resolution (was 128x256) — the old one made ~13px window blobs,
// which is what read as "brick game" at street level.
const ATLAS_W = 512;
const ATLAS_H = 1024;
const GRID = (() => {
  const winTopPx = Math.floor(ATLAS_H * (1 - WIN_V0)); // upper-floor region
  const cols = 5;
  const rows = 7;
  const colW = ATLAS_W / cols;
  const rowH = winTopPx / rows;
  const w = colW * 0.52; // window opening
  const h = rowH * 0.58;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: c * colW + (colW - w) / 2,
        y: r * rowH + (rowH - h) * 0.42,
        w,
        h,
        row: r,
        col: c,
      });
    }
  }
  return { winTopPx, cols, rows, colW, rowH, cells };
})();

/** deterministic PRNG so the atlas is identical every load */
const makeRnd = (seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/**
 * Procedural facade atlas. U wraps along the wall; V selects floor band.
 * Callers must remap ExtrudeGeometry UVs via remapWallUVs().
 */
export function makeFacadeAtlas() {
  const c = document.createElement("canvas");
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const g = c.getContext("2d");
  const rnd = makeRnd(20260805);
  const { winTopPx, rowH, cells } = GRID;

  // ---- wall base with subtle plaster mottling (kills flat-color plastic) ----
  g.fillStyle = "#efeae1";
  g.fillRect(0, 0, ATLAS_W, winTopPx);
  for (let i = 0; i < 2600; i++) {
    const a = 0.015 + rnd() * 0.05;
    g.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    const r = 1 + rnd() * 3;
    g.fillRect(rnd() * ATLAS_W, rnd() * winTopPx, r, r);
  }

  // ---- floor divider lines: horizontal storey banding ----
  for (let r = 1; r < GRID.rows; r++) {
    const y = Math.round(r * rowH);
    g.fillStyle = "rgba(0,0,0,0.10)";
    g.fillRect(0, y - 2, ATLAS_W, 2);
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fillRect(0, y, ATLAS_W, 1);
  }

  // ---- windows: reveal shadow, frame, mullions, glass gradient, sill ----
  for (const cell of cells) {
    const { x, y, w, h } = cell;
    // recess shadow (top + left) → reads as depth without a normal map
    g.fillStyle = "rgba(0,0,0,0.30)";
    g.fillRect(x - 3, y - 3, w + 6, h + 6);
    // frame
    g.fillStyle = "#5d5f63";
    g.fillRect(x - 2, y - 2, w + 4, h + 4);
    // glass: vertical sky gradient, darker at the bottom
    const grad = g.createLinearGradient(x, y, x, y + h);
    const tint = rnd();
    grad.addColorStop(0, tint < 0.5 ? "#8fb4d8" : "#7ea6cc");
    grad.addColorStop(0.45, "#41597a");
    grad.addColorStop(1, "#25344a");
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    // sky reflection wedge
    g.fillStyle = "rgba(210,232,250,0.5)";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + w * 0.55, y);
    g.lineTo(x, y + h * 0.5);
    g.closePath();
    g.fill();
    // mullions
    g.fillStyle = "rgba(70,72,78,0.95)";
    g.fillRect(x + w / 2 - 1.5, y, 3, h);
    g.fillRect(x, y + h * 0.42, w, 2.5);
    // some rooms have blinds — breaks up repetition
    if (rnd() < 0.28) {
      g.fillStyle = "rgba(232,226,210,0.82)";
      g.fillRect(x, y, w, h * (0.25 + rnd() * 0.35));
    }
    // sill catching light
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillRect(x - 3, y + h + 2, w + 6, 3);
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(x - 3, y + h + 5, w + 6, 3);
  }

  // ---- weathering: vertical grime streaks under sills + corner darkening ----
  for (let i = 0; i < 90; i++) {
    const sx = rnd() * ATLAS_W;
    const sy = rnd() * winTopPx;
    const sh = 20 + rnd() * 120;
    g.fillStyle = `rgba(60,55,48,${0.02 + rnd() * 0.05})`;
    g.fillRect(sx, sy, 1 + rnd() * 3, sh);
  }
  const vig = g.createLinearGradient(0, 0, 0, winTopPx);
  vig.addColorStop(0, "rgba(0,0,0,0.12)");
  vig.addColorStop(0.5, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.16)");
  g.fillStyle = vig;
  g.fillRect(0, 0, ATLAS_W, winTopPx);

  // ---- storefront band (bottom of atlas = high canvas Y) ----
  const storeH = Math.floor(ATLAS_H * STORE_V1);
  const sy0 = ATLAS_H - storeH;
  g.fillStyle = "#2b3038";
  g.fillRect(0, sy0, ATLAS_W, storeH);
  // stall risers
  g.fillStyle = "#20242b";
  g.fillRect(0, ATLAS_H - 14, ATLAS_W, 14);
  const paneW = ATLAS_W * 0.3;
  for (let i = 0; i < 2; i++) {
    const px = 20 + i * (paneW + 26);
    const pg = g.createLinearGradient(px, sy0 + 26, px, ATLAS_H - 20);
    pg.addColorStop(0, "#a9cbe6");
    pg.addColorStop(0.5, "#5c8bb4");
    pg.addColorStop(1, "#33526e");
    g.fillStyle = pg;
    g.fillRect(px, sy0 + 26, paneW, storeH - 46);
    // mullion + interior hint
    g.fillStyle = "rgba(40,44,52,0.9)";
    g.fillRect(px + paneW / 2 - 2, sy0 + 26, 4, storeH - 46);
    g.fillStyle = "rgba(255,236,190,0.20)";
    g.fillRect(px + 6, sy0 + storeH * 0.55, paneW - 12, storeH * 0.22);
  }
  // door with handle + frame
  const dx = ATLAS_W - 130;
  g.fillStyle = "#4a3527";
  g.fillRect(dx, sy0 + 26, 96, storeH - 40);
  g.fillStyle = "#6b4d38";
  g.fillRect(dx + 8, sy0 + 34, 80, storeH - 56);
  g.fillStyle = "#d8b95c";
  g.fillRect(dx + 74, sy0 + storeH * 0.5, 6, 20);
  // fascia above the shopfront
  g.fillStyle = "#1b1f26";
  g.fillRect(0, sy0, ATLAS_W, 22);
  g.fillStyle = "rgba(255,255,255,0.10)";
  g.fillRect(0, sy0 + 20, ATLAS_W, 2);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1, 1);
  t.flipY = true;
  t.anisotropy = 8;
  return t;
}

/** Night emissive atlas — uses the SAME grid so lit panes align exactly. */
export function makeLitWindowAtlas() {
  const c = document.createElement("canvas");
  c.width = ATLAS_W;
  c.height = ATLAS_H;
  const g = c.getContext("2d");
  g.fillStyle = "#000000";
  g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const rnd = makeRnd(7);

  for (const cell of GRID.cells) {
    if (rnd() < 0.42) {
      const { x, y, w, h } = cell;
      const warm = rnd() < 0.72;
      // glow core
      const grad = g.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, w * 0.85);
      grad.addColorStop(0, warm ? "#fff0c4" : "#dbeaff");
      grad.addColorStop(0.6, warm ? "#ffd98a" : "#bcd8ff");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - 4, y - 4, w + 8, h + 8);
      g.fillStyle = warm ? "#ffe6a8" : "#cfe4ff";
      g.fillRect(x, y, w, h);
      // mullion shadow keeps the pane readable when bloomed
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(x + w / 2 - 1.5, y, 3, h);
    }
  }

  // storefront glow
  const storeH = Math.floor(ATLAS_H * STORE_V1);
  const sy0 = ATLAS_H - storeH;
  const paneW = ATLAS_W * 0.3;
  for (let i = 0; i < 2; i++) {
    const px = 20 + i * (paneW + 26);
    g.fillStyle = "rgba(255,224,150,0.55)";
    g.fillRect(px, sy0 + 26, paneW, storeH - 46);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
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
