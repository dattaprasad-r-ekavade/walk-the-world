'use client';

/** Build a shareable /street deep link for the current (or given) coords. */
export function streetShareUrl(lat, lon, origin = typeof window !== 'undefined' ? window.location.origin : '') {
  if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null;
  return `${origin}/street?lat=${Number(lat).toFixed(5)}&lon=${Number(lon).toFixed(5)}`;
}

/** Copy text to clipboard; returns true on success. */
export async function copyText(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Capture a WebGL canvas as a PNG download.
 * Call after a fresh render so the buffer is still intact.
 */
export function downloadCanvasPng(canvas, filename = 'walk-the-world.png') {
  if (!canvas?.toDataURL) return false;
  try {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    return true;
  } catch {
    return false;
  }
}

/** Photo-mode filename: walktheworld · place · ISO date. */
export function photoFilename(placeLabel, lat, lon) {
  const day = new Date().toISOString().slice(0, 10);
  const spot =
    (placeLabel && String(placeLabel).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')) ||
    (lat != null && lon != null ? `${Number(lat).toFixed(3)}_${Number(lon).toFixed(3)}` : 'walk');
  return `walktheworld-${spot}-${day}.png`;
}
