// Procedural walk-cycle shader for instanced pedestrians (plan 15.1).
// Full Blender VAT textures can replace this later via asset library;
// this ships a limb-swing vertex shader so peds never read as static boxes.
import * as THREE from "three";

/**
 * MeshPhongMaterial with walk-cycle vertex deformation (instance aPhase).
 */
export function createWalkPedMaterial(baseColor = 0xffffff) {
  const mat = new THREE.MeshPhongMaterial({
    color: baseColor,
    shininess: 8,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uAmp = { value: 1 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aPhase;
uniform float uTime;
uniform float uAmp;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  float phase = uTime * 6.5 + aPhase;
  float swing = sin(phase) * uAmp;
  float y = transformed.y;
  if (y < 0.72) {
    float side = sign(transformed.x + 1e-4);
    transformed.z += swing * side * (0.72 - y) * 1.4;
    transformed.y += abs(swing) * 0.04 * (0.72 - y);
  } else if (y > 0.85 && y < 1.25) {
    float side = sign(transformed.x + 1e-4);
    transformed.z -= swing * side * 0.35;
  }
  transformed.y += abs(sin(phase)) * 0.03;
}`
      );
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => "wtw-walk-ped-v1";
  return mat;
}

export function setWalkPedTime(material, time, amp = 1) {
  const s = material?.userData?.shader;
  if (!s) return;
  s.uniforms.uTime.value = time;
  s.uniforms.uAmp.value = amp;
}
