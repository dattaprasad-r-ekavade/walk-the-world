// Procedural walk-cycle shader for instanced pedestrians (plan 15.1).
// Full Blender VAT textures can replace this later via asset library;
// this ships a limb-swing vertex shader so peds never read as static boxes.
import * as THREE from "three";

const WALK_DEFORMATION = `
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
}`;

function installWalkDeformation(material, uniforms, variant) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uAmp = uniforms.uAmp;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute float aPhase;\nuniform float uTime;\nuniform float uAmp;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${WALK_DEFORMATION}`
      );
    material.userData.shader = shader;
  };
  // Color, depth, and distance vertex shaders all expose
  // the common and begin_vertex chunks used above. Keep variant keys stable.
  material.customProgramCacheKey = () => `wtw-walk-ped-${variant}-v2`;
}

/** Create matching color and shadow materials sharing one pair of uniforms. */
export function createWalkPedMaterials(baseColor = 0xffffff) {
  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 1 },
  };
  const color = new THREE.MeshPhongMaterial({ color: baseColor, shininess: 8 });
  const depth = new THREE.MeshDepthMaterial();
  const distance = new THREE.MeshDistanceMaterial();

  installWalkDeformation(color, uniforms, "color");
  installWalkDeformation(depth, uniforms, "depth");
  installWalkDeformation(distance, uniforms, "distance");

  return { color, depth, distance, uniforms };
}

export function setWalkPedTime(materials, time, amp = 1) {
  const uniforms = materials?.uniforms;
  if (!uniforms) return;
  uniforms.uTime.value = time;
  uniforms.uAmp.value = amp;
}
