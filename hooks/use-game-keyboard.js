'use client';

import { useEffect } from 'react';

export function useGameKeyboard(handler, deps = []) {
  useEffect(() => {
    const onKey = (e) => handler(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, deps);
}
