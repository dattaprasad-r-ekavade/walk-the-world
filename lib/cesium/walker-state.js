/** @param {import('cesium').Viewer} viewer */
export function createWalkerState(Cesium) {
  return {
    active: false,
    lat: 0,
    lon: 0,
    heading: 0,
    pitch: 0,
    ground: 0,
    thirdPerson: false,
    moving: false,
    lastTime: 0,
  };
}

export const WALKER_TUNING = {
  EYE_HEIGHT: 1.7,
  WALK_SPEED: 4.5,
  RUN_MULT: 2.2,
  STEP: 1.4,
};
