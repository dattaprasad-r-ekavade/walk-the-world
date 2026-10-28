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
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";

// Final grade, applied after OutputPass (sRGB space): contrast around mid-grey,
// saturation, exposure and a subtle vignette in one fullscreen pass.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1.0 },
    contrast: { value: 1.05 },
    saturation: { value: 1.08 },
    vignette: { value: 0.25 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float exposure, contrast, saturation, vignette;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * exposure;
      col = (col - 0.5) * contrast + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

/**
 * High quality uses SSAO and bloom. Medium enables bloom only after dusk;
 * low keeps both passes off.
 * @param {"low"|"medium"|"high"} quality
 * @param {number} nightAmount 0–1
 */
export function getPostFxPassState(quality, nightAmount = 0) {
  const high = quality === "high";
  const nightBloom = quality === "medium" && nightAmount > 0.15;
  return { active: high || nightBloom, ssao: high };
}

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

  // FXAA (sRGB, after output) is only enabled when MSAA is unavailable and the
  // render scale drops below 1; the grade pass is always last.
  const fxaa = new ShaderPass(FXAAShader);
  fxaa.enabled = false;
  composer.addPass(fxaa);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  const syncFxaaRes = (width, height, pr) => {
    fxaa.material.uniforms.resolution.value.set(1 / Math.max(1, width * pr), 1 / Math.max(1, height * pr));
  };
  syncFxaaRes(w, h, renderer.getPixelRatio?.() ?? 1);

  let active = false;
  let disposed = false;

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
      syncFxaaRes(width, height, pr);
    },
    /** Enable the cheap AA pass (no-op cost while the composer is inactive). */
    setFxaa(on) {
      fxaa.enabled = !!on;
    },
    get fxaaActive() {
      return fxaa.enabled;
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
    get ssaoActive() {
      return ssao.enabled;
    },
    get bloomActive() {
      return bloom.enabled;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      setEnabled(false);
      ssao.dispose();
      // Three.js 0.170's SSAOPass.dispose omits these two owned resources.
      ssao.ssaoMaterial.dispose();
      ssao.noiseTexture?.dispose();
      bloom.dispose();
      output.dispose();
      fxaa.dispose();
      grade.dispose();
      composer.dispose();
    },
  };
}
