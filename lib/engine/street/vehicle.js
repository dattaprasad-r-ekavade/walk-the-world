// Arcade vehicle controller (plan 18.1).
import { STREET } from "@/lib/engine/street/constants";

const MAX_SPEED = 22; // m/s ≈ 80 km/h
const ACCEL = 14;
const BRAKE = 22;
const COAST = 4;
const STEER_RATE = 2.4;
const ENTER_DIST = 6.5;

/**
 * @param {{ insideBuilding: (x:number,z:number)=>boolean, groundHeight: (x:number,z:number)=>number }} ctx
 */
export function createVehicleController({ insideBuilding, groundHeight }) {
  const state = {
    active: false,
    carIndex: -1,
    speed: 0,
    heading: 0,
    x: 0,
    z: 0,
    y: 0,
  };

  const enter = (carPose, carIndex) => {
    if (!carPose) return false;
    state.active = true;
    state.carIndex = carIndex;
    state.x = carPose.x;
    state.z = carPose.z;
    state.y = carPose.y ?? groundHeight(carPose.x, carPose.z);
    // AI / mesh heading uses +Z forward; walk/drive uses −Z (heading 0). Convert.
    state.heading = (carPose.heading ?? 0) + Math.PI;
    state.speed = Math.min(carPose.speed || 4, 8);
    return true;
  };

  const exit = () => {
    const pose = {
      x: state.x - Math.sin(state.heading) * 2.2,
      z: state.z + Math.cos(state.heading) * 2.2,
      heading: state.heading,
      carIndex: state.carIndex,
      speed: state.speed,
    };
    state.active = false;
    state.carIndex = -1;
    state.speed = 0;
    return pose;
  };

  /**
   * @param {number} dt
   * @param {{ f: number, r: number, brake?: boolean }} input  f=throttle(-1..1), r=steer(-1..1)
   * @param {{ nearRoad?: boolean }} opts
   */
  const update = (dt, input, opts = {}) => {
    if (!state.active) return null;
    const throttle = Math.max(-1, Math.min(1, input.f || 0));
    const steer = Math.max(-1, Math.min(1, input.r || 0));
    const offRoad = opts.nearRoad === false;
    const maxSp = offRoad ? MAX_SPEED * 0.45 : MAX_SPEED;

    if (throttle > 0.05) state.speed += ACCEL * throttle * dt;
    else if (throttle < -0.05) state.speed -= BRAKE * Math.abs(throttle) * dt;
    else {
      if (state.speed > 0) state.speed = Math.max(0, state.speed - COAST * dt);
      else if (state.speed < 0) state.speed = Math.min(0, state.speed + COAST * dt);
    }
    state.speed = Math.max(-maxSp * 0.35, Math.min(maxSp, state.speed));

    // speed-based turn: tighter at low speed, slight drift feel at high
    const grip = 1 / (1 + Math.abs(state.speed) * 0.045);
    const turn = steer * STEER_RATE * grip * Math.sign(state.speed || throttle || 1);
    // allow steer while nearly stopped if throttling
    if (Math.abs(state.speed) > 0.4 || Math.abs(throttle) > 0.1) {
      state.heading += turn * dt * (0.55 + Math.min(1, Math.abs(state.speed) / 8));
    }

    const dist = state.speed * dt;
    const sin = Math.sin(state.heading);
    const cos = Math.cos(state.heading);
    // same forward as walking: heading 0 → −Z
    let nx = state.x + sin * dist;
    let nz = state.z - cos * dist;

    // bounce off buildings (not hard stop)
    const pad = 1.1;
    const hit = (x, z) => insideBuilding(x + sin * pad, z - cos * pad) || insideBuilding(x, z);
    if (hit(nx, nz)) {
      if (!hit(state.x, nz)) {
        nx = state.x;
      } else if (!hit(nx, state.z)) {
        nz = state.z;
      } else {
        nx = state.x;
        nz = state.z;
        state.speed *= -0.35; // bounce
      }
      state.speed *= 0.55;
    }
    state.x = nx;
    state.z = nz;
    state.y = groundHeight(state.x, state.z) + 0.05;

    return {
      x: state.x,
      z: state.z,
      y: state.y,
      heading: state.heading,
      speed: state.speed,
      carIndex: state.carIndex,
    };
  };

  return {
    state,
    enter,
    exit,
    update,
    ENTER_DIST,
    get active() {
      return state.active;
    },
  };
}

export { ENTER_DIST, MAX_SPEED };
