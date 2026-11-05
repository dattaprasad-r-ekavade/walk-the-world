// @ts-check
import { offsetRadians, ringSamples, saneHeight, walkDelta } from "./globe-math";

// Walking inside the Cesium globe (the "classic" walk engine and the F key):
// first- or third-person, collision against OSM Buildings, an animated avatar.

// Self-hosted copy of Khronos glTF-Sample-Models RiggedFigure (CC-BY 4.0, see
// CREDITS.md) so the walk avatar cannot change or vanish with an upstream branch.
const AVATAR_URL = "/models/rigged-figure.glb";
const AVATAR_HEADING_OFFSET = Math.PI / 2; // glTF forward-axis correction
export const EYE_HEIGHT = 1.8;
const WALK_SPEED = 5; // m/s
const RUN_MULT = 6;
const CHASE_BACK = 7.5; // third-person camera offset (m)
const CHASE_UP = 3.2;
const MAX_STEP = 1.4; // max climbable step (m): walls block, kerbs don't

/**
 * @param {object} deps
 * @param {any} deps.Cesium
 * @param {any} deps.viewer
 * @param {() => any} deps.getBuildings   loaded OSM Buildings tileset or null
 * @param {() => boolean} deps.hasTerrain
 */
export function createGlobeWalker({ Cesium, viewer, getBuildings, hasTerrain }) {
  const { scene, camera } = viewer;
  const state = {
    active: false,
    thirdPerson: false,
    lon: 0,
    lat: 0,
    heading: 0,
    pitch: 0,
    ground: 0,
    moving: false,
    lastTime: undefined,
  };

  const avatarPosition = () => Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.ground);
  const avatar = viewer.entities.add({
    show: false,
    position: new Cesium.CallbackProperty(avatarPosition, false),
    orientation: new Cesium.CallbackProperty(() => Cesium.Transforms.headingPitchRollQuaternion(
      avatarPosition(),
      new Cesium.HeadingPitchRoll(state.heading + AVATAR_HEADING_OFFSET, 0, 0),
    ), false),
    model: {
      uri: AVATAR_URL,
      scale: 1.1,
      minimumPixelSize: 0,
      runAnimations: true,
      color: Cesium.Color.fromCssColorString("#cdd8e8"), // clean matte tint
      colorBlendMode: Cesium.ColorBlendMode.MIX,
      colorBlendAmount: 0.6,
    },
  });

  const scratch = new Cesium.Cartographic();
  const at = (lon, lat) => {
    scratch.longitude = lon;
    scratch.latitude = lat;
    scratch.height = 0;
    return scratch;
  };

  /** Ground under the walker; buildings and the avatar are excluded. */
  const groundHeightAt = (lon, lat) => {
    let h;
    if (scene.sampleHeightSupported) {
      try {
        const exclude = [avatar];
        const buildings = getBuildings();
        if (buildings) exclude.push(buildings);
        h = saneHeight(scene.sampleHeight(at(lon, lat), exclude));
      } catch { /* not ready */ }
    }
    return h === undefined ? saneHeight(scene.globe.getHeight(at(lon, lat))) : h;
  };

  /** Height including buildings (only the avatar excluded), for collision. */
  const structureHeightAt = (lon, lat) => {
    if (!scene.sampleHeightSupported) return undefined;
    try {
      return saneHeight(scene.sampleHeight(at(lon, lat), [avatar]));
    } catch {
      return undefined;
    }
  };

  /** True when no building rises more than ~2 m above the terrain here. */
  const isOpenGround = (lon, lat) => {
    const structure = structureHeightAt(lon, lat);
    if (structure === undefined) return true;
    const terrain = saneHeight(scene.globe.getHeight(at(lon, lat)));
    return terrain === undefined || structure - terrain < 2.0;
  };

  /** Nearest building-free spot, so a walk never starts on a rooftop. */
  const findOpenGround = (lon, lat) => {
    if (isOpenGround(lon, lat)) return { lon, lat };
    for (const p of ringSamples(lat, lon)) if (isOpenGround(p.lon, p.lat)) return p;
    return { lon, lat };
  };

  const preciseGroundHeight = async (lonDeg, latDeg) => {
    if (!hasTerrain()) return 0;
    try {
      const [c] = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [Cesium.Cartographic.fromDegrees(lonDeg, latDeg)]);
      return saneHeight(c?.height) ?? 0;
    } catch {
      return 0;
    }
  };

  const applyCamera = () => {
    if (state.thirdPerson) {
      const back = offsetRadians(state.lat, state.lon, -Math.cos(state.heading) * CHASE_BACK, -Math.sin(state.heading) * CHASE_BACK);
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(back.lon, back.lat, state.ground + CHASE_UP),
        orientation: { heading: state.heading, pitch: Cesium.Math.toRadians(-14) + state.pitch * 0.4, roll: 0 },
      });
    } else {
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(state.lon, state.lat, state.ground + EYE_HEIGHT),
        orientation: { heading: state.heading, pitch: state.pitch, roll: 0 },
      });
    }
  };

  const setThirdPerson = (on) => {
    state.thirdPerson = on;
    avatar.show = on && state.active;
    if (state.active) applyCamera();
  };

  /** Starts walking at (lon, lat) radians, moved to open ground. */
  const start = async (lon, lat) => {
    const open = findOpenGround(lon, lat);
    const ground = groundHeightAt(open.lon, open.lat) ??
      (await preciseGroundHeight(Cesium.Math.toDegrees(open.lon), Cesium.Math.toDegrees(open.lat)));
    Object.assign(state, {
      lon: open.lon,
      lat: open.lat,
      ground: ground ?? 0,
      heading: camera.heading,
      pitch: 0,
      active: true,
      lastTime: undefined,
    });
    avatar.show = state.thirdPerson;
    applyCamera();
  };

  const stop = () => {
    const wasWalking = state.active;
    state.active = false;
    avatar.show = false;
    return wasWalking;
  };

  const look = (dx, dy) => {
    state.heading = Cesium.Math.zeroToTwoPi(state.heading + dx);
    state.pitch = Cesium.Math.clamp(state.pitch - dy, Cesium.Math.toRadians(-85), Cesium.Math.toRadians(85));
  };

  /**
   * One frame of walking. One height pick per frame on the destination;
   * extra slide picks only when blocked, so it stays smooth and cheap.
   * @param {number} now  performance.now() timestamp
   * @param {{ f: number, r: number, run: boolean, sampleGround: boolean }} input
   */
  const step = (now, { f, r, run, sampleGround }) => {
    const dt = state.lastTime ? Math.min((now - state.lastTime) / 1000, 0.1) : 0;
    state.lastTime = now;
    state.moving = !!(f || r);
    if (state.moving) {
      const { north, east } = walkDelta(state.heading, f, r, WALK_SPEED * (run ? RUN_MULT : 1) * dt);
      const next = offsetRadians(state.lat, state.lon, north, east);
      const canStand = (lo, la) => {
        const h = structureHeightAt(lo, la);
        return h === undefined || h - state.ground < MAX_STEP;
      };
      if (canStand(next.lon, next.lat)) {
        state.lat = next.lat;
        state.lon = next.lon;
      } else if (canStand(state.lon, next.lat)) {
        state.lat = next.lat; // slide along an east-west wall
      } else if (canStand(next.lon, state.lat)) {
        state.lon = next.lon; // slide along a north-south wall
      }
    }
    // Standing still, the ground cannot change under you: sample less often.
    const g = state.moving || sampleGround ? groundHeightAt(state.lon, state.lat) : undefined;
    if (g !== undefined) state.ground = Cesium.Math.lerp(state.ground, g, dt ? Math.min(1, dt * 8) : 1);
    applyCamera();
  };

  return { state, start, stop, step, look, setThirdPerson, preciseGroundHeight };
}
