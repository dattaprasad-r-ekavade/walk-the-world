'use client';

import { useEffect, useRef } from 'react';

/**
 * Window keydown listener that always calls the latest `handler` without
 * re-subscribing on every render.
 */
export function useGameKeyboard(handler) {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    const onKey = (e) => handlerRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
