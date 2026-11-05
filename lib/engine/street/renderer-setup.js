import * as THREE from "three";
import { createGpuFrameTimer } from "@/lib/engine/gpu-frame-timer";
import {
  appendGpuFrameTime,
  appendRendererFrame,
  getPerfCounters,
  markPerfMeasurementUnavailable,
  measurePerf,
  perfDiagnosticsEnabled,
  recordPerfTiming,
  setPerfEnvironment,
} from "@/lib/perf";
import { attributeProgramOwners, describeNewPrograms, newProgramsSince, programIdSet } from "./render-diagnostics";

/** True on touch-first or mobile user agents, where MSAA costs the most. */
export function isMobileViewport() {
  return window.matchMedia?.("(pointer: coarse)")?.matches ||
    /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || "");
}

/** Vendor/renderer strings and whether this is an Intel integrated GPU. */
export function describeGpu(gl) {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const vendor = String(info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) || "" : gl.getParameter(gl.VENDOR) || "");
  const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "" : gl.getParameter(gl.RENDERER) || "");
  return {
    vendor,
    renderer: name,
    debugRendererInfoAvailable: !!info,
    isIntelIntegrated: /Intel/i.test(`${vendor} ${name}`) && !/\bArc\b/i.test(name),
  };
}

/**
 * Shadow maps are refreshed on demand, not every frame. three.js re-renders
 * the whole shadow map each frame by default; with a 2048 map over ~2000
 * buildings that is a second full scene pass per frame, the single biggest
 * FPS cost. Callers request a refresh when the sun moves, the player leaves
 * the area the current map covers, or visible geometry changes.
 */
export function createShadowScheduler(renderer, { benchEnabled = false } = {}) {
  const requestCounts = Object.create(null);
  const audit = { enabled: false, forceEveryFrame: false, samples: [] };
  let sunHourBucket = null;

  const request = (reason) => {
    renderer.shadowMap.needsUpdate = true;
    requestCounts[reason] = (requestCounts[reason] || 0) + 1;
  };

  /** Refreshes when the sun crosses a half-hour bucket. */
  const updateSunBucket = (hour) => {
    const bucket = Math.round(hour * 2) / 2;
    if (bucket === sunHourBucket) return false;
    sunHourBucket = bucket;
    request("sun-bucket");
    return true;
  };

  // Benchmarks sample the CPU cost of each shadow pass.
  if (benchEnabled && typeof renderer.shadowMap.render === "function") {
    const renderShadowMap = renderer.shadowMap.render;
    renderer.shadowMap.render = function (...args) {
      const sample = audit.enabled && this.enabled && (this.autoUpdate || this.needsUpdate) && args[0]?.length > 0;
      const startedAt = sample ? performance.now() : 0;
      const callsBefore = sample ? renderer.info.render.calls : 0;
      const trianglesBefore = sample ? renderer.info.render.triangles : 0;
      try {
        return renderShadowMap.apply(this, args);
      } finally {
        if (sample) {
          audit.samples.push({
            cpuSubmitMs: performance.now() - startedAt,
            drawCalls: renderer.info.render.calls - callsBefore,
            triangles: renderer.info.render.triangles - trianglesBefore,
          });
          if (audit.samples.length > 512) audit.samples.shift();
        }
      }
    };
  }

  return {
    request,
    updateSunBucket,
    audit,
    requestCounts,
    get sunHourBucket() { return sunHourBucket; },
  };
}

/**
 * Creates the WebGL renderer for the street engine and attaches it to `mount`.
 * MSAA is disproportionately expensive on mobile/high-DPR canvases; the post
 * stack and facade geometry already give a clean silhouette, so it stays on
 * for ordinary desktop displays only.
 */
export function createStreetRenderer(mount, { benchEnabled = false } = {}) {
  const useMsaa = !isMobileViewport() && (window.devicePixelRatio || 1) <= 1.25;
  const renderer = new THREE.WebGLRenderer({ antialias: useMsaa, powerPreference: "high-performance" });
  const shadows = createShadowScheduler(renderer, { benchEnabled });
  // Keep renderer counters cumulative across the app's complete logical
  // frame, including composer passes. The counters are reset after each draw.
  renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const gl = renderer.getContext();
  const gpuTimer = createGpuFrameTimer(gl, {
    onSample: (durationMs) => appendGpuFrameTime(getPerfCounters(), durationMs),
  });
  const gpu = describeGpu(gl);
  setPerfEnvironment({
    webgl: {
      version: gl.getParameter(gl.VERSION),
      vendor: gpu.vendor,
      renderer: gpu.renderer,
      webgl2: renderer.capabilities.isWebGL2,
      debugRendererInfoAvailable: gpu.debugRendererInfoAvailable,
    },
  });
  const initialTimerState = gpuTimer.snapshot();
  const counters = getPerfCounters();
  if (counters) counters.gpuTimer = initialTimerState;
  if (!gpuTimer.supported) {
    markPerfMeasurementUnavailable("gpuFrameTimeMs", initialTimerState.reason || "GPU timer queries are unavailable.");
  }
  markPerfMeasurementUnavailable("estimatedGpuMemoryBytes", "WebGL does not expose reliable allocated VRAM bytes; geometry and texture object counts are reported instead.");
  markPerfMeasurementUnavailable(
    "ktx2GpuUploadCompletionMs",
    "WebGL exposes synchronous upload submission but not a portable completion timestamp; GPU residency is estimated from transcoded compressed mip payloads.",
  );
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  // Filmic tone mapping: richer sky gradients, softer highlights, deeper
  // shadow colour; the single cheapest whole-scene visual upgrade.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft PCF mode in r182+
  renderer.shadowMap.autoUpdate = false;
  shadows.request("engine-init");
  mount.appendChild(renderer.domElement);
  return { renderer, gl, gpu, gpuTimer, shadows, useMsaa };
}

/**
 * Renders one logical frame (post-FX composer or direct) and, while perf
 * diagnostics are on, records draw counters, GPU time and any shader programs
 * that had to link during the frame.
 */
export function createFrameRenderer({ renderer, scene, camera, gpuTimer, shadows, getPostFx, getQualityTier }) {
  return function renderFrame() {
    const diagnostics = perfDiagnosticsEnabled();
    const postFx = getPostFx();
    const programsBefore = diagnostics ? programIdSet(renderer) : null;
    const renderStartedAt = diagnostics ? performance.now() : 0;
    if (shadows.audit.enabled && shadows.audit.forceEveryFrame) shadows.request("shadow-audit-frame");
    if (diagnostics && renderer.info.autoReset) renderer.info.autoReset = false;
    const timerStarted = diagnostics && gpuTimer.beginFrame();
    try {
      measurePerf(postFx ? "renderer.postfx-cpu-submit" : "renderer.direct-cpu-submit", () => {
        if (postFx) postFx.render();
        else renderer.render(scene, camera);
      }, { qualityTier: getQualityTier() });
    } finally {
      if (timerStarted) gpuTimer.endFrame();
      if (diagnostics) recordFrameDiagnostics(renderer, scene, gpuTimer, programsBefore, performance.now() - renderStartedAt);
      renderer.info.reset();
    }
  };
}

function recordFrameDiagnostics(renderer, scene, gpuTimer, programsBefore, renderDurationMs) {
  const programs = renderer.info.programs || [];
  const newPrograms = newProgramsSince(renderer, programsBefore);
  if (renderDurationMs >= 50 || newPrograms.length) {
    const owners = attributeProgramOwners(renderer, scene, new Set(newPrograms.map((p) => p.id)), {
      sampleLimit: 6,
      dedupe: true,
      cellKeyRoot: scene,
    });
    recordPerfTiming(renderDurationMs >= 50 ? "renderer.long-frame-programs" : "renderer.program-link-frame", renderDurationMs, {
      programCountBefore: programsBefore.size,
      programCountAfter: programs.length,
      newProgramCount: newPrograms.length,
      newPrograms: describeNewPrograms(newPrograms, owners),
    });
  }
  const counters = getPerfCounters();
  const render = renderer.info.render;
  appendRendererFrame(counters, { calls: render.calls, triangles: render.triangles, lines: render.lines, points: render.points });
  const timerState = gpuTimer.snapshot();
  if (counters) counters.gpuTimer = timerState;
  if (!timerState.supported) {
    markPerfMeasurementUnavailable("gpuFrameTimeMs", timerState.reason || "GPU timer queries became unavailable.");
  }
}
