"use client";

import { useEffect, useRef } from "react";
import { trackMinimapDraw } from "@/lib/perf";

const TILE = 256;
const MAX_FPS = 15;
const IDLE_FPS = 2;

const tileCache = new Map();
function getTile(z, x, y, onLoad) {
  const n = 1 << z;
  x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return null;
  const key = `${z}/${x}/${y}`;
  let img = tileCache.get(key);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    img.onload = onLoad;
    tileCache.set(key, img);
    if (tileCache.size > 300) {
      const first = tileCache.keys().next().value;
      tileCache.delete(first);
    }
  }
  return img;
}

function zoomForHeight(h) {
  if (!h || h < 400) return 17;
  const z = Math.round(17 - Math.log2(h / 400));
  return Math.max(2, Math.min(17, z));
}

export default function Minimap({ lat, lon, heading = 0, height, size = 176, zoomBias = 0, posRef }) {
  const SIZE = size;
  const canvasRef = useRef(null);
  const stateRef = useRef({ lat, lon, heading, height });
  stateRef.current = { lat, lon, heading, height };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext("2d");
    let raf;
    let lastDraw = 0;
    let lastPos = { lat: null, lon: null, heading: null };
    let moving = false;

    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      const live = posRef?.current;
      const { lat, lon, heading, height } = live || stateRef.current;

      const posChanged =
        lat !== lastPos.lat ||
        lon !== lastPos.lon ||
        heading !== lastPos.heading;
      if (posChanged) moving = true;
      lastPos = { lat, lon, heading };

      const minInterval = 1000 / (moving ? MAX_FPS : IDLE_FPS);
      if (now - lastDraw < minInterval) return;
      if (!posChanged && !moving && now - lastDraw < 1000) return;

      lastDraw = now;
      if (!posChanged) moving = false;
      trackMinimapDraw();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);

      ctx.save();
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#0b1322";
      ctx.fillRect(0, 0, SIZE, SIZE);

      if (lat !== undefined && lat !== null && isFinite(lat)) {
        const z = Math.max(2, Math.min(18, zoomForHeight(height) + zoomBias));
        const n = 1 << z;
        const xf = ((lon + 180) / 360) * n;
        const latR = (lat * Math.PI) / 180;
        const yf =
          ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
        const cx = SIZE / 2;
        const cy = SIZE / 2;
        const range = Math.ceil(SIZE / TILE / 2) + 1;
        const bx = Math.floor(xf);
        const by = Math.floor(yf);
        for (let dx = -range; dx <= range; dx++) {
          for (let dy = -range; dy <= range; dy++) {
            const img = getTile(z, bx + dx, by + dy, () => {});
            if (img && img.complete && img.naturalWidth) {
              const px = cx + (bx + dx - xf) * TILE;
              const py = cy + (by + dy - yf) * TILE;
              ctx.drawImage(img, px, py, TILE, TILE);
            }
          }
        }
        const grad = ctx.createRadialGradient(cx, cy, SIZE * 0.25, cx, cy, SIZE * 0.55);
        grad.addColorStop(0, "rgba(5,10,20,0)");
        grad.addColorStop(1, "rgba(5,10,20,0.55)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, SIZE, SIZE);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(heading || 0);
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(7, 8);
        ctx.lineTo(0, 4);
        ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.fillStyle = "#ffd75e";
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(140,170,220,0.5)";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("locating…", SIZE / 2, SIZE / 2);
      }
      ctx.restore();

      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 3, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(150,185,255,0.55)";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = "#e8edf5";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("N", SIZE / 2, 14);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [SIZE, zoomBias, posRef]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded-full bg-void-900 shadow-hud"
      style={{ width: SIZE, height: SIZE }}
    />
  );
}
