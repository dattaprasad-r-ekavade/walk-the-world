/**
 * Quality-gated post stack: SSAO + UnrealBloom (16.2).
 * Only enabled when settings.quality === "high".
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 */
export function createPostFx(renderer, scene, camera) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const w = Math.max(1, size.x);
  const h = Math.max(1, size.y);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const ssao = new SSAOPass(scene, camera, w, h, 16);
  ssao.kernelRadius = 12;
  ssao.minDistance = 0.002;
  ssao.maxDistance = 0.12;
  ssao.output = SSAOPass.OUTPUT.Default;
  ssao.enabled = false;
  composer.addPass(ssao);

  // Half resolution: bloom is a blur anyway, and this quarters its fill cost.
  const bloom = new UnrealBloomPass(new THREE.Vector2(Math.max(1, w >> 1), Math.max(1, h >> 1)), 0.28, 0.45, 0.82);
  bloom.enabled = false;
  composer.addPass(bloom);

  // Keep OutputPass last: it applies the single tone/output-space conversion
  // for composer rendering. Direct rendering uses renderer output settings.
  const output = new OutputPass();
  composer.addPass(output);

  let active = false;

  /**
   * ssaoOn is gated on the "high" tier, but bloom is cheap enough to run at
   * night on medium — emissive-only glow is most of the night look (21.0).
   */
  const setEnabled = (on, ssaoOn = on) => {
    active = !!on;
    ssao.enabled = active && !!ssaoOn;
    bloom.enabled = active;
  };

  return {
    setEnabled,
    setSize(width, height, pixelRatio) {
      const pr = pixelRatio ?? renderer.getPixelRatio();
      composer.setPixelRatio(pr);
      composer.setSize(width, height);
      ssao.setSize(width, height);
      bloom.setSize(Math.max(1, Math.round((width * pr) / 2)), Math.max(1, Math.round((height * pr) / 2)));
    },
    /** Night windows/lamps bloom a bit more. */
    setNightBloom(amount = 0) {
      // Keep night bulbs legible without letting nearby lamps wash out the view.
      const a = Math.max(0, Math.min(1, amount));
      bloom.strength = 0.22 + a * 0.32;
      bloom.radius = 0.4 + a * 0.2;
      bloom.threshold = 0.9 - a * 0.12;
    },
    render() {
      if (active) composer.render();
      else renderer.render(scene, camera);
    },
    get active() {
      return active;
    },
    dispose() {
      setEnabled(false);
      composer.dispose();
    },
  };
}
