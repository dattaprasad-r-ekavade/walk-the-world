"use client";

import { useEffect, useRef, useState } from "react";
import { createGlobeRuntime } from "@/lib/globe/runtime";
import { useGameStore } from "@/stores/game-store";

const globeStore = {
  getSettings: () => useGameStore.getState().settings,
  changeSetting: (patch) => useGameStore.getState().changeSetting(patch),
};

/**
 * React shell around the Cesium globe (lib/globe/runtime.js). The runtime is
 * created once per mount; callbacks are read through a ref so parents can
 * pass fresh closures without restarting the globe.
 */
export default function Globe({ controllerRef, onReady, onStatus, onProgress, posRef, onDepart, onArrive }) {
  const [error, setError] = useState(null);
  const containerRef = useRef(null);
  const callbacksRef = useRef({ onReady, onStatus, onProgress, onDepart, onArrive });

  useEffect(() => {
    callbacksRef.current = { onReady, onStatus, onProgress, onDepart, onArrive };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const callbacks = () => callbacksRef.current;
    const runtime = createGlobeRuntime(container, {
      onProgress: (p) => callbacks().onProgress?.(p),
      onStatus: (s) => callbacks().onStatus?.(s),
      onReady: (info) => callbacks().onReady?.(info),
      onDepart: (lat, lon) => callbacks().onDepart?.(lat, lon),
      onArrive: callbacks().onArrive ? (lat, lon, opts) => callbacks().onArrive(lat, lon, opts) : null,
      onController: (controller) => { if (controllerRef) controllerRef.current = controller; },
      posRef,
      store: globeStore,
    });
    let disposed = false;
    runtime.ready.catch((e) => { if (!disposed) setError(e); });
    return () => {
      disposed = true;
      if (controllerRef) controllerRef.current = null;
      runtime.dispose();
    };
    // One globe per mount; see callbacksRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) throw error;
  return <div ref={containerRef} className="cesium-container" />;
}
