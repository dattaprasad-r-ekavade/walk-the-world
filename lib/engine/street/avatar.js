import * as THREE from "three";
import { getSimpleStandard } from "@/lib/engine/materials";

/** Static third-person mannequin (no rig, no animation). Hidden until V. */
export function createMannequin() {
  const g = new THREE.Group();
  const bodyMat = getSimpleStandard(0x6d84a8, { roughness: 0.75 });
  const legMat = getSimpleStandard(0x3f4a5c, { roughness: 0.8 });
  const skinMat = getSimpleStandard(0xd9c2a8, { roughness: 0.65 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.62, 4, 10), bodyMat);
  body.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), skinMat);
  head.position.y = 1.62;
  for (const sx of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.6, 8), legMat);
    leg.position.set(sx, 0.3, 0);
    g.add(leg);
  }
  for (const sx of [-0.34, 0.34]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.5, 3, 8), bodyMat);
    arm.position.set(sx, 1.05, 0);
    g.add(arm);
  }
  g.add(body, head);
  g.visible = false;
  return g;
}

/**
 * Car headlights. They stay in the scene permanently at intensity 0: three.js
 * bakes the light COUNT into every lit material's shader, so adding, removing
 * or hiding them when a drive starts would recompile the whole city.
 */
export function createHeadlights(scene) {
  const left = new THREE.SpotLight(0xfff2dd, 0, 48, 0.42, 0.45, 1.2);
  const right = new THREE.SpotLight(0xfff2dd, 0, 48, 0.42, 0.45, 1.2);
  scene.add(left, right, left.target, right.target);

  const off = () => {
    left.intensity = 0;
    right.intensity = 0;
  };

  /** Aims both lamps along the car nose (+Z at heading 0). */
  const update = (pose, night) => {
    const intensity = night ? 2.4 : 0;
    left.intensity = intensity;
    right.intensity = intensity;
    const sin = Math.sin(pose.heading), cos = Math.cos(pose.heading);
    const fx = pose.x + sin * 2.2;
    const fz = pose.z + cos * 2.2;
    left.position.set(pose.x - cos * 0.6, pose.y + 0.9, pose.z + sin * 0.6);
    right.position.set(pose.x + cos * 0.6, pose.y + 0.9, pose.z - sin * 0.6);
    left.target.position.set(fx, pose.y + 0.4, fz);
    right.target.position.set(fx, pose.y + 0.4, fz);
  };

  return { update, off };
}
