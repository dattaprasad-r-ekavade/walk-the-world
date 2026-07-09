/**
 * Export a shareable "walk card" PNG from passport + trail (10.5).
 */

/**
 * @param {{
 *   totalKm?: number,
 *   elevClimbed?: number,
 *   cities?: Record<string, { km: number }>,
 *   countries?: Record<string, number>,
 *   trail?: { lat: number, lon: number }[],
 * }} passport
 * @param {{ place?: string }} [opts]
 * @returns {HTMLCanvasElement}
 */
export function renderWalkCard(passport, opts = {}) {
  const W = 720;
  const H = 420;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0c1528");
  bg.addColorStop(0.55, "#152238");
  bg.addColorStop(1, "#1a2a1f");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // soft vignette
  const vig = g.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 420);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);

  g.strokeStyle = "rgba(255,217,122,0.35)";
  g.lineWidth = 2;
  g.strokeRect(18, 18, W - 36, H - 36);

  g.fillStyle = "#ffd97a";
  g.font = '700 22px "Segoe UI", system-ui, sans-serif';
  g.fillText("Walk the World", 40, 58);

  g.fillStyle = "#e8edf5";
  g.font = '600 28px "Segoe UI", system-ui, sans-serif';
  const title = opts.place || "Walk card";
  g.fillText(title.length > 36 ? title.slice(0, 34) + "…" : title, 40, 98);

  const totalKm = passport?.totalKm || 0;
  const elev = Math.round(passport?.elevClimbed || 0);
  const cities = Object.keys(passport?.cities || {}).length;
  const countries = Object.keys(passport?.countries || {}).length;

  const stats = [
    [`${totalKm < 10 ? totalKm.toFixed(2) : totalKm.toFixed(1)} km`, "walked"],
    [`${elev} m`, "climbed"],
    [String(cities), cities === 1 ? "place" : "places"],
    [String(countries || "—"), countries === 1 ? "country" : "countries"],
  ];
  stats.forEach(([val, label], i) => {
    const x = 40 + i * 165;
    g.fillStyle = "#ffffff";
    g.font = '700 26px "Segoe UI", system-ui, sans-serif';
    g.fillText(val, x, 160);
    g.fillStyle = "rgba(180,200,230,0.75)";
    g.font = '500 13px "Segoe UI", system-ui, sans-serif';
    g.fillText(label, x, 182);
  });

  // trail map panel
  const px = 40;
  const py = 210;
  const pw = W - 80;
  const ph = 150;
  g.fillStyle = "rgba(8,14,24,0.75)";
  g.fillRect(px, py, pw, ph);
  g.strokeStyle = "rgba(150,185,255,0.25)";
  g.strokeRect(px, py, pw, ph);

  const trail = passport?.trail || [];
  if (trail.length >= 2) {
    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;
    for (const p of trail) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const pad = 0.0004;
    minLat -= pad;
    maxLat += pad;
    minLon -= pad;
    maxLon += pad;
    const dLat = Math.max(1e-6, maxLat - minLat);
    const dLon = Math.max(1e-6, maxLon - minLon);
    // keep aspect
    const aspect = pw / ph;
    if (dLon / dLat > aspect) {
      const mid = (minLat + maxLat) / 2;
      const half = dLon / aspect / 2;
      minLat = mid - half;
      maxLat = mid + half;
    } else {
      const mid = (minLon + maxLon) / 2;
      const half = (dLat * aspect) / 2;
      minLon = mid - half;
      maxLon = mid + half;
    }
    const toXY = (lat, lon) => ({
      x: px + ((lon - minLon) / (maxLon - minLon)) * pw,
      y: py + ph - ((lat - minLat) / (maxLat - minLat)) * ph,
    });
    g.beginPath();
    trail.forEach((p, i) => {
      const { x, y } = toXY(p.lat, p.lon);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.strokeStyle = "#ffd75e";
    g.lineWidth = 2.5;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.stroke();
    const end = toXY(trail[trail.length - 1].lat, trail[trail.length - 1].lon);
    g.fillStyle = "#ffd75e";
    g.beginPath();
    g.arc(end.x, end.y, 4, 0, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = "rgba(140,170,220,0.55)";
    g.font = '14px "Segoe UI", system-ui, sans-serif';
    g.textAlign = "center";
    g.fillText("Walk to draw a trail on the map", px + pw / 2, py + ph / 2);
    g.textAlign = "left";
  }

  g.fillStyle = "rgba(180,200,230,0.55)";
  g.font = '12px "Segoe UI", system-ui, sans-serif';
  g.fillText("walktheworld · local passport", 40, H - 28);

  return c;
}

/** Download walk card as PNG. */
export function downloadWalkCard(passport, opts = {}) {
  const canvas = renderWalkCard(passport, opts);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `walk-card-${stamp}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
  return canvas;
}
