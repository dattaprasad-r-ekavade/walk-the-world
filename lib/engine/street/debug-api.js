// @ts-check
import * as THREE from "three";
import { materialFactoryInventory, setWetRoadMapCandidate, wetRoadMapStats } from "@/lib/engine/materials";
import { setPerfMetadata } from "@/lib/perf";

// `window.__streetDebug`: the inspection and control surface the Playwright
// harnesses (scripts/bench-perf.mjs, validate-street.mjs, s7-tour.mjs) drive.
// Everything that changes engine state is a no-op outside bench mode.

const TEXTURE_ROLES = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"];

/** Materials, textures and geometry the scene graph currently references. */
export function sceneMaterialInventory(scene) {
  const materials = new Map();
  const textures = new Map();
  const geometries = new Set();
  let meshCount = 0;
  let instancedMeshCount = 0;
  let instanceCount = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshCount++;
    if (o.geometry?.uuid) geometries.add(o.geometry.uuid);
    if (o.isInstancedMesh) {
      instancedMeshCount++;
      instanceCount += o.count || 0;
    }
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!material) continue;
      let entry = materials.get(material.uuid);
      if (!entry) {
        entry = {
          uuid: material.uuid,
          name: material.name || "",
          type: material.type,
          color: material.color?.getHexString?.() || null,
          vertexColors: !!material.vertexColors,
          transparent: !!material.transparent,
          side: material.side,
          roughness: Number.isFinite(material.roughness) ? material.roughness : null,
          metalness: Number.isFinite(material.metalness) ? material.metalness : null,
          shared: !!material.userData?.shared,
          roles: [],
          meshUses: 0,
        };
        materials.set(material.uuid, entry);
      }
      entry.meshUses++;
      for (const role of TEXTURE_ROLES) {
        const texture = material[role];
        if (!texture) continue;
        if (!entry.roles.includes(role)) entry.roles.push(role);
        let tex = textures.get(texture.uuid);
        if (!tex) {
          const image = texture.image || {};
          tex = {
            uuid: texture.uuid,
            width: image.width || image.videoWidth || null,
            height: image.height || image.videoHeight || null,
            colorSpace: texture.colorSpace,
            roles: [],
          };
          textures.set(texture.uuid, tex);
        }
        if (!tex.roles.includes(role)) tex.roles.push(role);
      }
    }
  });
  const families = new Map();
  const roleBindings = new Map();
  for (const material of materials.values()) {
    const family = [
      material.type,
      material.roles.join("+") || "unmapped",
      material.vertexColors ? "vertex-color" : "no-vertex-color",
      material.transparent ? "transparent" : "opaque",
      `side-${material.side}`,
    ].join("|");
    const entry = families.get(family) || { family, materialCount: 0, meshUses: 0, colorVariants: new Set() };
    entry.materialCount++;
    entry.meshUses += material.meshUses;
    entry.colorVariants.add(material.color);
    families.set(family, entry);
    for (const role of material.roles) {
      const roleEntry = roleBindings.get(role) || { role, materialBindings: 0, meshBindings: 0, uniqueTextures: 0 };
      roleEntry.materialBindings++;
      roleEntry.meshBindings += material.meshUses;
      roleBindings.set(role, roleEntry);
    }
  }
  for (const texture of textures.values()) {
    for (const role of texture.roles) {
      const roleEntry = roleBindings.get(role);
      if (roleEntry) roleEntry.uniqueTextures++;
    }
  }
  return {
    meshCount,
    uniqueGeometryCount: geometries.size,
    instancedMeshCount,
    instanceCount,
    uniqueMaterialCount: materials.size,
    uniqueTextureCount: textures.size,
    textureRoleBindings: [...roleBindings.values()].sort((a, b) => a.role.localeCompare(b.role)),
    materialFamilies: [...families.values()]
      .map(({ colorVariants, ...entry }) => ({ ...entry, colorVariantCount: colorVariants.size }))
      .sort((a, b) => b.meshUses - a.meshUses),
    materials: [...materials.values()],
    textures: [...textures.values()],
    factoryCache: materialFactoryInventory(),
  };
}

function triangleCount(geometry) {
  return geometry?.index ? geometry.index.count / 3 : (geometry?.attributes?.position?.count || 0) / 3;
}

/**
 * @param {object} ctx  live engine handles; getters are used for values that
 *   change after boot (population, quality tier, night amount).
 */
export function createStreetDebugApi(ctx) {
  const { bench, scene, renderer, shadows, player, fly, vehicle, runtime, cityBuilder, envCtrl,
    getPostFx, setPostFxOverride, getPopulation, getQualityTier, getNightAmount, getRenderScale,
    getHour, insideBuilding, groundHeight, pickPoint, resolveOsmAt, setQuality, setTime, setWeather,
    readOnlyCityData } = ctx;

  const rooftopClutterShadowStats = () => {
    let meshCount = 0, visibleMeshCount = 0, castShadowMeshCount = 0, triangles = 0;
    const objects = [];
    let nearestTarget = null;
    let nearestTargetDistance = Infinity;
    scene.traverse((object) => {
      if (!object.isMesh || object.userData?.shadowPruningRole !== "rooftop-clutter") return;
      meshCount++;
      if (object.visible) visibleMeshCount++;
      if (object.castShadow) castShadowMeshCount++;
      const objectTriangles = triangleCount(object.geometry);
      triangles += objectTriangles;
      const bounds = new THREE.Box3().setFromObject(object);
      objects.push({
        center: bounds.getCenter(new THREE.Vector3()).toArray(),
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        triangles: objectTriangles,
      });
      for (const position of object.userData?.shadowPruningTargets || []) {
        const world = object.localToWorld(new THREE.Vector3(...position));
        const distance = Math.hypot(world.x - player.x, world.z - player.z);
        if (distance < nearestTargetDistance) {
          nearestTargetDistance = distance;
          nearestTarget = { x: world.x, y: world.y, z: world.z, distance };
        }
      }
    });
    return {
      meshCount,
      visibleMeshCount,
      castShadowMeshCount,
      triangles,
      casts: runtime.rooftopClutterShadowEnabled !== false,
      objects,
      nearestTarget,
    };
  };

  const setRooftopClutterShadowCasting = (casts) => {
    const enabled = casts === true;
    runtime.rooftopClutterShadowEnabled = enabled;
    let changedMeshCount = 0;
    scene.traverse((object) => {
      if (!object.isMesh || object.userData?.shadowPruningRole !== "rooftop-clutter") return;
      if (object.castShadow === enabled) return;
      object.castShadow = enabled;
      changedMeshCount++;
    });
    if (changedMeshCount > 0) shadows.request("rooftop-clutter-shadow-toggle");
    return { ...rooftopClutterShadowStats(), changedMeshCount };
  };

  const shadowAuditState = () => ({
    enabled: shadows.audit.enabled,
    forceEveryFrame: shadows.audit.forceEveryFrame,
    sunHourBucket: shadows.sunHourBucket,
    refreshRequests: { ...shadows.requestCounts },
    rooftopClutter: rooftopClutterShadowStats(),
    samples: shadows.audit.samples.slice(),
  });

  const streetLightPool = () => {
    const group = scene.getObjectByName("streetLights");
    const lights = group ? group.children.filter((c) => c.isSpotLight) : [];
    return {
      pool: lights.length,
      on: lights.filter((l) => l.visible && l.intensity > 0).length,
      assigned: lights.filter((l) => l.userData.assigned).length,
      visible: lights.filter((l) => l.visible).length,
    };
  };

  return {
    player,
    vehicle,
    fly,
    insideBuilding,
    groundHeight,
    cityDataCopyMode: readOnlyCityData ? "readonly" : "clone",
    setQuality: (quality) => {
      if (!bench.enabled || !["low", "medium", "high"].includes(quality)) return false;
      setQuality(quality);
      return true;
    },
    rendererTextureCount: () => renderer.info.memory.textures,
    renderScale: getRenderScale,
    setWetRoadMapCandidate: (enabled) => (bench.enabled ? setWetRoadMapCandidate(enabled) : null),
    wetRoadMapStats: () => (bench.enabled ? wetRoadMapStats() : null),
    propMarkers: () => runtime.propMarkers || [],
    streetLightStats: () => {
      const lights = runtime.streetLights;
      const lampMarkers = (runtime.propMarkers || []).filter((marker) => marker.kind === "lamp").length;
      if (!lights) {
        return { pool: 0, on: 0, assigned: 0, visible: 0, lampMarkers, qualityTier: getQualityTier(),
          nightAmount: getNightAmount(), keepInactiveVisible: null };
      }
      return { ...streetLightPool(), lampMarkers, qualityTier: getQualityTier(), nightAmount: getNightAmount(),
        keepInactiveVisible: lights.keepInactiveVisible };
    },
    shaderProgramCount: () => renderer.info.programs?.length ?? null,
    setInactiveStreetLightsVisible: (visible) => {
      const lights = runtime.streetLights;
      if (!lights) return null;
      lights.setKeepInactiveVisible(visible === true);
      const { pool, on, visible: shown } = streetLightPool();
      return { pool, on, visible: shown, keepInactiveVisible: lights.keepInactiveVisible };
    },
    nameplates: () => getPopulation()?.getNameplateStats?.(player) || [],
    // How the opening shot was framed (lib/engine/street/spawn.js): mode,
    // metres moved from the requested point, and the view-cone score.
    spawnFraming: () => runtime.spawnFraming || null,
    cellStream: () => runtime.cellStreamer?.debugState?.() || null,
    cityBuilder: () => cityBuilder.debugState(),
    environmentState: () => envCtrl.debugState?.() || null,
    rooftopClutterShadowStats,
    shadowRefreshState: () => ({
      sunHourBucket: shadows.sunHourBucket,
      pending: renderer.shadowMap.needsUpdate,
      requestCounts: { ...shadows.requestCounts },
    }),
    shadowAuditState,
    /** @param {{ enabled?: boolean, forceEveryFrame?: boolean, rooftopClutterCasts?: boolean, resetMeasurements?: boolean }} [options] */
    setShadowAuditState: ({ enabled = false, forceEveryFrame = false, rooftopClutterCasts, resetMeasurements = false } = {}) => {
      if (!bench.enabled) return null;
      if (typeof rooftopClutterCasts === "boolean") setRooftopClutterShadowCasting(rooftopClutterCasts);
      if (resetMeasurements) shadows.audit.samples.length = 0;
      shadows.audit.enabled = enabled === true;
      shadows.audit.forceEveryFrame = shadows.audit.enabled && forceEveryFrame === true;
      if (shadows.audit.forceEveryFrame) shadows.request("shadow-audit");
      return shadowAuditState();
    },
    /** @param {{ enabled?: boolean, position?: { x: number, y: number, z: number }, target?: { x: number, y: number, z: number } }} [options] */
    setShadowAuditCamera: ({ enabled = true, position, target } = {}) => {
      if (!bench.enabled) return null;
      if (!enabled) {
        fly.photo = false;
        return { enabled: false };
      }
      if (!position || !target ||
          ![position.x, position.y, position.z, target.x, target.y, target.z].every(Number.isFinite)) return null;
      const dx = target.x - position.x, dy = target.y - position.y, dz = target.z - position.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < 1) return null;
      Object.assign(fly, {
        photo: true,
        x: position.x,
        y: position.y,
        z: position.z,
        heading: Math.atan2(dx, -dz),
        pitch: Math.asin(Math.max(-1, Math.min(1, dy / distance))),
        orbit: null,
        pan: false,
      });
      return { enabled: true, position: { x: fly.x, y: fly.y, z: fly.z }, target, heading: fly.heading, pitch: fly.pitch };
    },
    setPostFxState: ({ active, ssao, bloom }) => {
      const postFx = getPostFx();
      if (!postFx) return null;
      const bloomEnabled = bloom === undefined ? active === true : bloom === true;
      setPostFxOverride({ active: active === true, ssao: ssao === true, bloom: bloomEnabled });
      postFx.setEnabled(active === true, ssao === true, postFx.composerActive, bloomEnabled);
      const state = { postFxActive: postFx.active, ssaoActive: postFx.ssaoActive, bloomActive: postFx.bloomActive };
      setPerfMetadata(state);
      return state;
    },
    population: getPopulation,
    tickPopulation: () => getPopulation()?.update?.(1 / 60, player, getHour(), false),
    setTime,
    setWeather,
    pickAt: (clientX, clientY) => {
      const hit = pickPoint({ clientX, clientY });
      return hit ? resolveOsmAt(hit) : null;
    },
    meshes: () => {
      const out = [];
      scene.traverse((o) => {
        if (!o.isMesh) return;
        const b = new THREE.Box3().setFromObject(o);
        out.push({
          tris: triangleCount(o.geometry),
          min: b.min.toArray().map((v) => Math.round(v)),
          max: b.max.toArray().map((v) => Math.round(v)),
          color: o.material.color?.getHexString?.(),
          hasMap: !!o.material.map,
        });
      });
      return out;
    },
    materialInventory: () => sceneMaterialInventory(scene),
  };
}
