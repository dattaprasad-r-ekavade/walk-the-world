// Procedural HDRI / IBL (plan 17.2): build an equirectangular sky canvas from
// time-of-day + weather, run through PMREMGenerator → scene.environment.
import * as THREE from "three";

/**
 * Paint a 512×256 equirectangular sky gradient into a canvas.
 * @param {number} hour 0–24
 * @param {number} weatherAmt 0–1
 */
export function paintSkyEquirect(hour, weatherAmt = 0) {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const t = ((hour - 6) / 12) * Math.PI;
  const elev = Math.sin(t);
  let top, mid, bot;
  if (elev > 0.25) {
    top = [120, 180, 235];
    mid = [160, 200, 235];
    bot = [200, 220, 230];
  } else if (elev > -0.05) {
    // dusk / dawn
    const k = (elev + 0.05) / 0.3;
    top = lerp3([20, 24, 50], [120, 180, 235], k);
    mid = lerp3([200, 100, 60], [160, 200, 235], k);
    bot = lerp3([240, 140, 80], [200, 220, 230], k);
  } else {
    top = [6, 10, 28];
    mid = [12, 18, 40];
    bot = [18, 22, 45];
  }
  // overcast grey
  if (weatherAmt > 0) {
    const grey = [140, 145, 150];
    top = lerp3(top, grey, weatherAmt * 0.7);
    mid = lerp3(mid, grey, weatherAmt * 0.7);
    bot = lerp3(bot, grey, weatherAmt * 0.55);
  }
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `rgb(${top})`);
  grad.addColorStop(0.45, `rgb(${mid})`);
  grad.addColorStop(1, `rgb(${bot})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // soft sun disc on the equirect (u from solar azimuth)
  if (elev > -0.1) {
    const u = ((Math.cos(t) + 1) / 2) * w;
    const v = (0.5 - elev * 0.35) * h;
    const sun = g.createRadialGradient(u, v, 2, u, v, 28);
    sun.addColorStop(0, `rgba(255,250,220,${0.9 * Math.max(0, elev + 0.1)})`);
    sun.addColorStop(1, "rgba(255,200,100,0)");
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
  }
  return c;
}

function lerp3(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Create / update scene.environment from time + weather.
 * Returns a dispose helper for the previous env map.
 */
export function createEnvController(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let current = null;
  let lastKey = "";

  const apply = (scene, hour, weatherAmt) => {
    const key = `${Math.round(hour * 2) / 2}_${Math.round(weatherAmt * 5) / 5}`;
    if (key === lastKey && current) return;
    lastKey = key;
    const canvas = paintSkyEquirect(hour, weatherAmt);
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const env = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    if (current) current.dispose();
    current = env;
    scene.environment = env;
    scene.environmentIntensity = 0.65 + Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)) * 0.35;
  };

  const dispose = () => {
    if (current) current.dispose();
    current = null;
    pmrem.dispose();
  };

  return { apply, dispose };
}
