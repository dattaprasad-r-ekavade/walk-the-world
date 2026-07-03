import { trackHudUpdate, recordFpsSample } from '@/lib/perf';

export function createHudRef(root) {
  const els = {
    fps: root.querySelector('[data-hud-fps]'),
    elev: root.querySelector('[data-hud-elev]'),
    hint: root.querySelector('[data-hud-hint]'),
  };

  let lastFps = 0;
  let hudTick = 0;

  const update = ({ fps, elev, locked, third }) => {
    if (++hudTick % 4 !== 0) return;
    trackHudUpdate();
    if (fps > 0 && fps !== lastFps) {
      recordFpsSample(fps);
      lastFps = fps;
      if (els.fps) {
        els.fps.textContent = `${fps} FPS`;
        els.fps.classList.toggle('text-amber-300', fps < 40);
        els.fps.classList.toggle('text-sky-300', fps >= 40);
      }
    }
    if (els.elev && elev !== undefined) els.elev.textContent = `⛰ ${elev} m`;
    if (els.hint) {
      els.hint.textContent = locked
        ? 'WASD move · mouse look · Shift sprint · V view · Tab map · M travel'
        : 'Click the view to capture the mouse · WASD to walk · M travel · P menu';
    }
    if (third !== undefined) {
      /* reserved for future third-person chip */
    }
  };

  const setLocked = (locked) => update({ locked });

  return { update, setLocked, els };
}
