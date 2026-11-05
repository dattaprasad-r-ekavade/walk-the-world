import * as THREE from "three";
import { markPerf, measurePerfAsync, perfDiagnosticsEnabled } from "@/lib/perf";
import { attributeProgramOwners, describeNewPrograms, newProgramsSince, programIdSet } from "./render-diagnostics";

// Shader pre-compilation for content that is about to become visible.
//
// Drawing a mesh with a new material links its shader program synchronously
// on first use; on an Intel UHD laptop the spawn city's ~40 programs froze the
// page for ~6 s that way. compileAsync links them in parallel
// (KHR_parallel_shader_compile) and compiles hidden objects too, using the
// scene's lights, so city groups stay hidden until their warm-up resolves.

/** The side three.js renders a material's shadow-depth pass with. */
export function shadowSideFor(material) {
  if (material.shadowSide !== null && material.shadowSide !== undefined) return material.shadowSide;
  if (material.side === THREE.FrontSide) return THREE.BackSide;
  if (material.side === THREE.BackSide) return THREE.FrontSide;
  return THREE.DoubleSide;
}

/**
 * Key for the depth-material variant three.js would build for this
 * mesh/material pair. Pairs with the same key share one shadow program.
 */
export function shadowDepthSignature(object, source) {
  return JSON.stringify({
    attributes: Object.keys(object.geometry.attributes || {}).sort(),
    morphAttributes: Object.entries(object.geometry.morphAttributes || {})
      .map(([name, entries]) => [name, entries.length]),
    instanced: object.isInstancedMesh === true,
    instanceColor: object.instanceColor != null,
    mapChannel: source.map?.channel ?? null,
    alphaMapChannel: source.alphaMap?.channel ?? null,
    displacementMapChannel: source.displacementMap?.channel ?? null,
    alphaTest: source.alphaToCoverage === true ? 0.5 : source.alphaTest || 0,
    alphaToCoverage: source.alphaToCoverage === true,
    shadowSide: shadowSideFor(source),
    wireframe: source.wireframe === true,
    clippingPlaneCount: source.clipShadows ? source.clippingPlanes?.length || 0 : 0,
    clipIntersection: source.clipIntersection === true,
  });
}

/**
 * @param {object} deps
 * @param {THREE.WebGLRenderer} deps.renderer
 * @param {THREE.Scene} deps.scene
 * @param {THREE.Camera} deps.camera
 * @param {() => any} deps.getPostFx            current post-FX stack (may be null)
 * @param {() => string} deps.getQualityTier
 * @param {(reason: string) => void} deps.requestShadowRefresh
 */
export function createShaderWarmup({ renderer, scene, camera, getPostFx, getQualityTier, requestShadowRefresh }) {
  const depthMaterials = new Set();
  let postFxStarted = false;

  // Fog is part of a program's key. Three's shadow pass renders without a
  // Scene, so depth variants must compile with fog off to match.
  const withoutFog = (fn) => {
    const previousFog = scene.fog;
    try {
      scene.fog = null;
      return fn();
    } finally {
      scene.fog = previousFog;
    }
  };

  const warmCell = async (group, label = "city.cell-shader-warmup") => {
    if (typeof renderer.compileAsync !== "function") return;
    try {
      const diagnostics = perfDiagnosticsEnabled();
      const programIdsBefore = diagnostics ? programIdSet(renderer) : null;
      await measurePerfAsync(label, () => {
        // compileAsync does its synchronous compile() before returning, so the
        // render target only needs to be swapped around that call.
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(getPostFx()?.sceneTarget ?? null);
        try {
          return renderer.compileAsync(group, camera, scene);
        } finally {
          renderer.setRenderTarget(previous);
        }
      });
      if (diagnostics) {
        let spotLightCount = 0;
        scene.traverseVisible((object) => {
          if (object.isSpotLight && object.layers.test(camera.layers)) spotLightCount += 1;
        });
        const programs = renderer.info.programs || [];
        const newPrograms = newProgramsSince(renderer, programIdsBefore);
        const owners = attributeProgramOwners(renderer, group, new Set(newPrograms.map((p) => p.id)));
        markPerf("renderer.shader-warmup-complete", {
          label,
          spotLightCount,
          programCountBefore: programIdsBefore.size,
          programCountAfter: programs.length,
          newProgramCount: newPrograms.length,
          newPrograms: describeNewPrograms(newPrograms, owners),
        });
      }
    } catch (error) {
      console.warn("[street] shader warm-up failed:", error?.message || error);
    }
  };

  // Builds one depth-material proxy per distinct shadow variant under `root`
  // and compiles them, so the first shadow-map refresh links nothing.
  const warmShadowDepth = async (root, label) => {
    const warmGroup = new THREE.Group();
    const variants = new Set();
    root.traverse((object) => {
      if (!object.isMesh || !object.castShadow || object.customDepthMaterial || !object.geometry) return;
      const sources = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const source of sources) {
        if (!source?.visible) continue;
        const signature = shadowDepthSignature(object, source);
        if (variants.has(signature)) continue;
        variants.add(signature);
        const depth = new THREE.MeshDepthMaterial({
          map: source.map || null,
          alphaMap: source.alphaMap || null,
          alphaTest: source.alphaToCoverage === true ? 0.5 : source.alphaTest || 0,
          displacementMap: source.displacementMap || null,
          displacementScale: source.displacementScale,
          displacementBias: source.displacementBias,
          side: shadowSideFor(source),
          wireframe: source.wireframe,
          wireframeLinewidth: source.wireframeLinewidth,
          linewidth: source.linewidth,
          clipShadows: source.clipShadows,
          clippingPlanes: source.clippingPlanes,
          clipIntersection: source.clipIntersection,
          alphaToCoverage: source.alphaToCoverage,
        });
        let proxy;
        if (object.isInstancedMesh) {
          proxy = new THREE.InstancedMesh(object.geometry, depth, 1);
          if (object.instanceColor) proxy.setColorAt(0, new THREE.Color(0xffffff));
        } else {
          proxy = new THREE.Mesh(object.geometry, depth);
        }
        proxy.frustumCulled = false;
        warmGroup.add(proxy);
        depthMaterials.add(depth);
      }
    });
    if (!variants.size) return;
    await withoutFog(() => warmCell(warmGroup, label));
  };

  // Population is created hidden; compile its colour, shadow-depth and the
  // pedestrians' custom depth material before it becomes visible.
  const warmPopulation = async (group, pedestrianMesh) => {
    if (!group) return;
    group.visible = true;
    const colorWarmup = warmCell(group, "city.population-shader-warmup");
    group.visible = false;
    await colorWarmup;
    await warmShadowDepth(group, "city.population-shadow-depth-warmup");
    if (pedestrianMesh?.customDepthMaterial) {
      const colorMaterial = pedestrianMesh.material;
      const depthMaterial = pedestrianMesh.customDepthMaterial;
      const previousSide = depthMaterial.side;
      depthMaterial.side = colorMaterial.shadowSide !== null
        ? colorMaterial.shadowSide
        : shadowSideFor({ side: colorMaterial.side });
      group.visible = true;
      pedestrianMesh.material = depthMaterial;
      const depthWarmup = withoutFog(() => warmCell(pedestrianMesh, "city.population-depth-shader-warmup"));
      pedestrianMesh.material = colorMaterial;
      depthMaterial.side = previousSide;
      group.visible = false;
      await depthWarmup;
    }
    group.visible = true;
    requestShadowRefresh("population-visible");
  };

  /** Bloom shaders, once per engine, the first time a tier above low runs. */
  const warmPostFx = () => {
    const postFx = getPostFx();
    if (postFxStarted || getQualityTier() === "low" || !postFx?.warmBloomShaders) return;
    postFxStarted = true;
    const programsBefore = programIdSet(renderer);
    const startedAt = performance.now();
    postFx.warmBloomShaders().then((result) => {
      const programs = renderer.info.programs || [];
      markPerf("renderer.postfx-shader-warmup-complete", {
        ...result,
        durationMs: performance.now() - startedAt,
        programCountBefore: programsBefore.size,
        programCountAfter: programs.length,
        newProgramCount: programs.filter((program) => !programsBefore.has(program.id)).length,
      });
    }).catch((error) => {
      console.warn("[street] post-FX shader warm-up failed:", error?.message || error);
    });
  };

  const dispose = () => {
    for (const material of depthMaterials) material.dispose();
    depthMaterials.clear();
  };

  return { warmCell, warmShadowDepth, warmPopulation, warmPostFx, dispose };
}
