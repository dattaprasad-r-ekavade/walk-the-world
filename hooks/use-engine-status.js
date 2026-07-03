'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { trackStatusUpdate } from '@/lib/perf';

const DEFAULT_STATUS = {
  mode: 'fly',
  view: 'first',
  elevation: null,
  locked: false,
  lat: undefined,
  lon: undefined,
  heading: 0,
  height: null,
  fps: 0,
};

export function useEngineStatus(throttleMs = 250) {
  const posRef = useRef(null);
  const statusRef = useRef({ ...DEFAULT_STATUS });
  const [hudStatus, setHudStatus] = useState({ ...DEFAULT_STATUS });
  const lastPublish = useRef(0);
  const dirty = useRef(false);

  const publishStatus = useCallback(
    (patch) => {
      trackStatusUpdate();
      Object.assign(statusRef.current, patch);
      dirty.current = true;
      const now = Date.now();
      if (now - lastPublish.current >= throttleMs) {
        lastPublish.current = now;
        dirty.current = false;
        setHudStatus({ ...statusRef.current });
      }
    },
    [throttleMs]
  );

  useEffect(() => {
    const id = setInterval(() => {
      if (!dirty.current) return;
      dirty.current = false;
      lastPublish.current = Date.now();
      setHudStatus({ ...statusRef.current });
    }, throttleMs);
    return () => clearInterval(id);
  }, [throttleMs]);

  return { posRef, statusRef, hudStatus, publishStatus, setHudStatus };
}
