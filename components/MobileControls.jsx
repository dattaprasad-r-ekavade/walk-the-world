'use client';

import { useEffect, useRef, useState } from 'react';
import { createTouchState, touchInputRef } from '@/lib/touch-input';

function useCoarsePointer() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse), (max-width: 768px)');
    const update = () => setShow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return show;
}

export function MobileControls({ enabled = true }) {
  const show = useCoarsePointer();
  const stickRef = useRef(null);
  const stateRef = useRef(createTouchState());
  const stickId = useRef(null);
  const lookId = useRef(null);
  const stickOrigin = useRef({ x: 0, y: 0 });
  const lookLast = useRef({ x: 0, y: 0 });
  const [, tick] = useState(0);

  useEffect(() => {
    touchInputRef.current = stateRef.current;
    return () => {
      if (touchInputRef.current === stateRef.current) touchInputRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!show) return;
    let raf;
    const loop = () => {
      tick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [show]);

  if (!enabled || !show) return null;

  const maxStick = 38;
  const knobX = stateRef.current.moveX * maxStick;
  const knobY = -stateRef.current.moveY * maxStick;

  const onStickStart = (e) => {
    const t = e.changedTouches[0];
    stickId.current = t.identifier;
    const rect = stickRef.current.getBoundingClientRect();
    stickOrigin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    stateRef.current.active = true;
    e.preventDefault();
  };

  const onStickMove = (e) => {
    const t = [...e.changedTouches].find((x) => x.identifier === stickId.current);
    if (!t) return;
    const dx = t.clientX - stickOrigin.current.x;
    const dy = t.clientY - stickOrigin.current.y;
    const len = Math.hypot(dx, dy) || 1;
    const clamp = Math.min(len, maxStick) / len;
    stateRef.current.moveX = (dx * clamp) / maxStick;
    stateRef.current.moveY = -(dy * clamp) / maxStick;
    e.preventDefault();
  };

  const onStickEnd = (e) => {
    if (![...e.changedTouches].some((x) => x.identifier === stickId.current)) return;
    stickId.current = null;
    stateRef.current.moveX = 0;
    stateRef.current.moveY = 0;
    if (!lookId.current) stateRef.current.active = false;
    e.preventDefault();
  };

  const onLookStart = (e) => {
    const t = e.changedTouches[0];
    lookId.current = t.identifier;
    lookLast.current = { x: t.clientX, y: t.clientY };
    stateRef.current.active = true;
    e.preventDefault();
  };

  const onLookMove = (e) => {
    const t = [...e.changedTouches].find((x) => x.identifier === lookId.current);
    if (!t) return;
    stateRef.current.lookDX += (t.clientX - lookLast.current.x) * 0.004;
    stateRef.current.lookDY += (t.clientY - lookLast.current.y) * 0.004;
    lookLast.current = { x: t.clientX, y: t.clientY };
    e.preventDefault();
  };

  const onLookEnd = (e) => {
    if (![...e.changedTouches].some((x) => x.identifier === lookId.current)) return;
    lookId.current = null;
    if (!stickId.current) stateRef.current.active = false;
    e.preventDefault();
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[25] touch-none" aria-hidden="true">
      <div
        ref={stickRef}
        className="pointer-events-auto absolute bottom-4 left-3 flex h-24 w-24 touch-none items-center justify-center rounded-full border border-mint/20 bg-[rgba(6,15,25,0.76)] shadow-[0_8px_28px_rgba(0,0,0,0.48)] backdrop-blur-md"
        onTouchStart={onStickStart}
        onTouchMove={onStickMove}
        onTouchEnd={onStickEnd}
        onTouchCancel={onStickEnd}
      >
        <div
          className="h-10 w-10 rounded-full border border-white/25 bg-slate-200/85 shadow-lg transition-transform duration-75"
          style={{ transform: `translate(${knobX}px, ${knobY}px)` }}
        />
      </div>
      <div
        className="pointer-events-auto absolute bottom-0 right-0 h-[55vh] w-[45vw] touch-none"
        onTouchStart={onLookStart}
        onTouchMove={onLookMove}
        onTouchEnd={onLookEnd}
        onTouchCancel={onLookEnd}
      />
      <button
        type="button"
        className="pointer-events-auto absolute bottom-5 right-4 rounded-full border border-trail/50 bg-[rgba(42,31,12,0.86)] px-4 py-3 text-[11px] font-bold tracking-widest text-amber-100 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md active:scale-95"
        onTouchStart={(e) => {
          stateRef.current.sprint = true;
          e.preventDefault();
        }}
        onTouchEnd={(e) => {
          stateRef.current.sprint = false;
          e.preventDefault();
        }}
      >
        RUN
      </button>
    </div>
  );
}
