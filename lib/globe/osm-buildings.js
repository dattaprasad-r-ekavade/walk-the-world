// Cesium OSM Buildings, styled by a custom shader so the city reads as a
// designed game world rather than melted photogrammetry.
//
// High tier only, loaded the first time the camera comes within
// BUILDINGS_LOAD_HEIGHT of the ground. The tileset JSON and lit shaders
// roughly doubled main-thread blocking on an Intel UHD laptop (globe load
// 5.7-6.4 s vs 3.0-3.7 s without, zoom-in 4.0-5.0 s vs 2.2-2.5 s), and loading
// them lazily on medium only moved that cost into the zoom. The street engine
// carries the city detail; flights to it hide these anyway.

export const BUILDINGS_LOAD_HEIGHT = 20000; // metres above the ellipsoid

// Cesium cannot combine a Cesium3DTileStyle with a CustomShader (the style
// silently wins), so all colouring happens here: per-block palette tint plus a
// per-floor window grid on walls, clean roofs.
const FACADE_SHADER = `
  void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
    vec3 pos = fsInput.attributes.positionMC;
    // OSM Buildings tiles are ENU-oriented: model +Z is up.
    vec3 upEC = normalize((czm_modelView * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
    vec3 nEC = normalize(fsInput.attributes.normalEC);
    float wallness = 1.0 - smoothstep(0.55, 0.8, abs(dot(nEC, upEC)));

    // per-block tint so neighbouring buildings differ
    vec2 cell = floor(pos.xy / 34.0);
    float h1 = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 28001.8384);
    vec3 base = vec3(0.88, 0.85, 0.79);
    base = mix(base, vec3(0.70, 0.77, 0.86), step(0.62, h1));
    base = mix(base, vec3(0.83, 0.76, 0.66), step(0.55, h2) * step(h1, 0.62));
    base = mix(base, vec3(0.76, 0.72, 0.78), step(0.85, h1));

    // window grid: floors every ~3.1 m, columns every ~3.4 m
    float floorBand = fract(pos.z / 3.1);
    float rowWin = step(0.3, floorBand) * step(floorBand, 0.78);
    float colBand = fract((pos.x + pos.y) / 3.4);
    float colWin = step(0.22, colBand) * step(colBand, 0.75);
    float window = rowWin * colWin * wallness;

    vec3 glass = vec3(0.16, 0.22, 0.31) + h2 * 0.08;
    material.diffuse = mix(base, glass, window * 0.92);
    material.specular = mix(vec3(0.02), vec3(0.45), window);
    material.roughness = mix(0.9, 0.2, window);
    material.diffuse *= mix(0.86, 1.0, wallness);
  }
`;

/**
 * @param {any} Cesium
 * @param {any} scene
 * @param {{ enabled: boolean, isDestroyed: () => boolean }} options
 *   enabled: an ion token is configured (the tileset needs it)
 */
export function createOsmBuildings(Cesium, scene, { enabled, isDestroyed }) {
  let tileset = null;
  let loading = null;
  let facadeShader = null;
  let tier = "medium";

  const applyTier = () => {
    if (!tileset) return;
    tileset.maximumScreenSpaceError = 20;
    tileset.customShader = facadeShader;
    tileset.show = tier === "high";
  };

  const load = async () => {
    try {
      const loaded = await Cesium.createOsmBuildingsAsync({ maximumScreenSpaceError: 24 });
      if (isDestroyed()) {
        loaded.destroy?.();
        return null;
      }
      tileset = loaded;
      tileset.dynamicScreenSpaceError = true;
      tileset.dynamicScreenSpaceErrorDensity = 0.002;
      try {
        tileset.customShader = new Cesium.CustomShader({
          mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
          lightingModel: Cesium.LightingModel.PBR,
          fragmentShaderText: FACADE_SHADER,
        });
      } catch (e) {
        console.warn("[cesium] facade shader unavailable:", e?.message);
      }
      facadeShader = tileset.customShader || null;
      applyTier();
      scene.primitives.add(tileset);
      return tileset;
    } catch (e) {
      console.warn("[cesium] OSM Buildings unavailable:", e?.message);
      return null;
    }
  };

  return {
    /** The loaded tileset, or null. */
    get tileset() { return tileset; },
    get requested() { return loading !== null; },
    /** Starts the one-time load (no-op without an ion token). */
    ensure() {
      if (!loading && enabled) loading = load();
      return loading;
    },
    setTier(next) {
      tier = next;
      applyTier();
    },
    /**
     * Coarser LOD while the camera flies. Street-bound flights also hide the
     * tileset: profiled on an Intel UHD laptop, it spent ~0.8 s parsing
     * tileset JSON and ~1.5 s linking shaders during the flight, for buildings
     * the street engine replaces on arrival.
     */
    setFlight(on, hide = false) {
      if (!tileset) return;
      tileset.maximumScreenSpaceError = on ? 64 : 20;
      tileset.show = !(on && hide);
    },
  };
}
