// @ts-check
import * as THREE from "three";
import { createEnvController } from "@/lib/engine/env-map";
import { setInteriorMappingLighting, setRoadEnvironment } from "@/lib/engine/materials";

const DAY_SKY = new THREE.Color(0x9cc4e8);
const DUSK_SKY = new THREE.Color(0xd8926a);
const NIGHT_SKY = new THREE.Color(0x121b2d); // deep blue: keeps the horizon readable
const FOG_WARM = new THREE.Color(0xe9b48a); // sun-side horizon haze

/** Sun elevation (sin of the solar arc) for a local solar hour; 6h sunrise, 18h sunset. */
export function solarArc(hour) {
  const t = ((hour - 6) / 12) * Math.PI;
  return { t, elev: Math.sin(t) };
}

/** 0 by day, rising to 0.85 as the sun sets: drives windows, lamps and bloom. */
export function nightGlow(elev) {
  return Math.max(0, Math.min(1, (0.08 - elev) * 9)) * 0.85;
}

/** Exponential fog density for the sun elevation, weather (0..1) and night glow. */
export function fogDensity(elev, weather, glow) {
  const duskMood = 1 - Math.abs(elev); // 0 at noon, 1 at the horizon
  const weatherDens = weather * (elev > 0.25 ? 0.00065 : elev > -0.05 ? 0.00048 : 0.00028);
  return 0.00032 + duskMood * 0.00018 + weatherDens + glow * 0.00018;
}

/** Tone-mapping exposure: warmer/brighter dusk, cooler night. */
export function exposureFor(elev, glow) {
  return elev > 0.2 ? 1.08 : elev > 0 ? 1.2 : 0.92 + glow * 0.25;
}

function makeGlowSprite(inner, outer, size) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

/**
 * Sky colour, fog, sun/moon, hemisphere fill, the shadow-casting sun and the
 * image-based environment for one scene.
 */
export function createSky(scene, renderer) {
  scene.background = new THREE.Color(0x9cc4e8);
  // Exp2 fog reads more natural at distance; near/far are tuned in apply().
  scene.fog = new THREE.FogExp2(0x9cc4e8, 0.00055);

  const sunSprite = makeGlowSprite("rgba(255,250,230,1)", "rgba(255,215,130,0.85)", 420);
  const moonSprite = makeGlowSprite("rgba(235,240,250,1)", "rgba(190,205,230,0.5)", 260);
  scene.add(sunSprite);
  scene.add(moonSprite);

  // The hemisphere is a soft fill; IBL (scene.environment) does most ambient work.
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x8c8474, 0.35);
  scene.add(hemi);
  const envCtrl = createEnvController(renderer);
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(300, 500, -200);
  // One tight shadow map around the player: a big depth win for ~1-2 ms.
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1200;
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  const sunDir = new THREE.Vector3(300, 500, -200);
  const skyColor = new THREE.Color();
  const overcast = new THREE.Color();

  /**
   * Applies the time of day and weather (0..1) to sky, fog, lights, the
   * environment map and exposure. Returns the values the rest of the engine
   * keys off: `glow` (night amount for windows/lamps/bloom) and `night`.
   */
  const apply = (hour, weather) => {
    const { t, elev } = solarArc(hour);
    sunDir.set(Math.cos(t) * 500, Math.max(elev, 0.08) * 500, -200);
    sun.position.set(sunDir.x, sunDir.y, sunDir.z);
    sun.intensity = Math.max(0, elev) * 1.6 + 0.05;
    // The higher night floor keeps unlit street surfaces from collapsing to black.
    hemi.intensity = 0.38 + Math.max(0, elev) * 0.08;
    envCtrl.apply(scene, hour, weather);
    setRoadEnvironment(scene.environment);
    const glow = nightGlow(elev);
    setInteriorMappingLighting(glow);

    if (elev > 0.25) skyColor.copy(DAY_SKY);
    else if (elev > -0.05) skyColor.lerpColors(DUSK_SKY, DAY_SKY, (elev + 0.05) / 0.3);
    else skyColor.copy(NIGHT_SKY);
    const overcastHex = elev > 0.25 ? 0x8a8f96 : elev > -0.05 ? 0x766d74 : 0x37414f;
    const weatherBlend = weather * (elev > 0.25 ? 0.7 : elev > -0.05 ? 0.55 : 0.5);
    skyColor.lerp(overcast.setHex(overcastHex), weatherBlend);
    scene.background = skyColor;
    scene.fog.color.copy(skyColor);
    // Near sunrise/sunset distant blocks fade toward a warm horizon haze.
    const hazeWarm = Math.max(0, 1 - Math.abs(elev) / 0.35) * (1 - weather * 0.7) * 0.35;
    if (hazeWarm > 0) scene.fog.color.lerp(FOG_WARM, hazeWarm);
    scene.fog.density = fogDensity(elev, weather, glow);
    renderer.toneMappingExposure = exposureFor(elev, glow);

    // Sun and moon ride opposite ends of the same arc.
    sunSprite.position.set(Math.cos(t) * 4200, elev * 4200, -1600);
    moonSprite.position.set(-Math.cos(t) * 4200, -elev * 4200, -1600);
    sunSprite.material.opacity = Math.max(0, Math.min(1, (elev + 0.08) * 5)) * (1 - weather * 0.8);
    moonSprite.material.opacity = Math.max(0, Math.min(1, (-elev + 0.08) * 5)) * (1 - weather * 0.8);
    return { glow, night: elev < 0.12 };
  };

  /** Keeps the shadow frustum centred on the player, offset toward the sun. */
  const followPlayer = (x, y, z) => {
    sun.target.position.set(x, y, z);
    sun.position.set(x + sunDir.x, y + sunDir.y, z + sunDir.z);
  };

  const dispose = () => {
    setRoadEnvironment(null);
    envCtrl.dispose();
    sun.shadow.dispose();
  };

  return { sun, apply, followPlayer, envCtrl, dispose };
}
