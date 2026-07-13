export const overlay =
  'absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[radial-gradient(circle_at_50%_34%,rgba(26,88,104,.42),rgba(3,7,13,.92)_58%,#03050a_100%)] px-4 py-8 backdrop-blur-[2px]';

export const overlayDim = 'absolute inset-0 z-40 flex items-center justify-center bg-void-950/80 backdrop-blur-sm';

export const menuCard = 'animate-fade-up text-center px-5 py-7 sm:px-10 sm:py-10';

export const menuTitle =
  'font-display mt-5 text-[2.65rem] leading-[.95] sm:text-6xl font-extrabold tracking-[0.08em] text-white drop-shadow-[0_4px_34px_rgba(118,247,210,.18)]';

export const menuTitleSm =
  'font-display text-3xl font-extrabold tracking-[0.1em] text-white';

export const menuSub =
  'mt-3 text-[11px] sm:text-xs uppercase tracking-[0.2em] text-mint/80';

export const menuLogo = 'mx-auto h-16 w-16 sm:h-20 sm:w-20 drop-shadow-glow';

export const menuBtn =
  'w-full min-h-12 rounded-2xl border border-white/10 bg-white/[.045] px-5 py-3 text-sm font-medium tracking-wide text-slate-100 shadow-[0_8px_30px_rgba(0,0,0,.22)] transition-all duration-200 hover:-translate-y-0.5 hover:border-mint/35 hover:bg-white/[.075] disabled:cursor-wait disabled:opacity-50';

export const menuBtnPrimary =
  'w-full min-h-12 rounded-2xl border border-mint/50 bg-gradient-to-r from-[#23a98f] to-[#177f73] px-5 py-3 text-sm font-extrabold tracking-wide text-white shadow-[0_12px_34px_rgba(35,169,143,.25)] transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-wait disabled:opacity-50';

// Opaque dark chrome — readable over bright sky / white buildings (not frosted glass)
// Z-INDEX LANES (keep every absolute element in its lane):
//   0     world canvas
//   10-20 in-world overlays (toasts pinned to gameplay, editor chrome)
//   30    persistent HUD bars (top bar, status strip, mode hints)
//   40-45 full-screen dims (loading, menu, big map)
//   50    modal panels (travel/settings/pause)
//   60    notifications (share toast) — nothing may sit above these
const chrome =
  'border border-white/10 bg-[rgba(6,15,25,0.90)] text-slate-100 shadow-[0_8px_34px_rgba(0,0,0,0.48)] backdrop-blur-xl';

export const glassPanel =
  `absolute left-1/2 top-1/2 z-50 w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 animate-fade-up rounded-2xl ${chrome} p-5 sm:p-6`;

export const panelHead = 'mb-4 flex items-center justify-between';

export const panelTitle = 'text-base font-semibold tracking-wide text-white';

export const panelClose =
  'rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white';

export const travelBtn =
  'rounded-xl border border-white/15 bg-[#121a2a] px-3.5 py-3 text-left text-sm text-slate-100 transition-all hover:border-accent-bright/50 hover:bg-[#1a2438]';

export const travelBtnWide =
  'col-span-2 rounded-xl border border-emerald-400/40 bg-gradient-to-b from-emerald-600 to-emerald-800 px-3.5 py-3 text-center text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50';

/** Left-rail / compact icon button */
export const toolbarBtn =
  `flex h-10 w-10 items-center justify-center rounded-xl ${chrome} text-sm text-slate-200 transition-all hover:border-mint/45 hover:bg-[#102739] hover:text-white`;

export const toolbarBtnActive =
  'flex h-10 w-10 items-center justify-center rounded-xl border border-mint/55 bg-[rgba(22,96,88,0.92)] text-sm text-white shadow-[0_5px_20px_rgba(0,0,0,0.4)]';

export const hudChip =
  `rounded-xl ${chrome} px-3 py-1.5 text-xs font-semibold tracking-wide text-slate-100 tabular-nums`;

export const hudChipMode =
  'rounded-xl border border-emerald-400/40 bg-[rgba(10,31,24,0.92)] px-3 py-1.5 text-xs font-semibold tracking-wide text-emerald-200 shadow-[0_4px_16px_rgba(0,0,0,0.4)]';

export const statusCard =
  `min-w-0 rounded-lg ${chrome} px-2.5 py-1.5`;

export const statusCardLabel =
  'text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400';

export const statusCardValue =
  'mt-0.5 text-xs font-semibold tracking-wide text-white tabular-nums';

export const coordsPill =
  `rounded-full ${chrome} px-2.5 py-0.5 text-[10px] tracking-wide text-slate-200 tabular-nums`;

export const hintBar =
  `pointer-events-none absolute bottom-3 left-1/2 z-20 hidden max-w-[min(640px,70vw)] -translate-x-1/2 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full ${chrome} px-3 py-1 text-[10px] text-slate-400 lg:flex`;

export const topBar =
  'pointer-events-none absolute inset-x-0 top-0 z-30 grid grid-cols-[auto_1fr_auto] items-start gap-2 px-2 pt-2 sm:items-center sm:gap-3 sm:px-4 sm:pt-3';

export const topBarInner =
  `pointer-events-auto flex items-center gap-2 rounded-xl ${chrome} px-2.5 py-1.5`;

export const searchField =
  `pointer-events-auto mx-auto hidden h-10 w-[min(360px,42vw)] items-center gap-2 rounded-full ${chrome} px-4 text-sm text-slate-100 transition-colors hover:border-mint/35 focus-within:border-mint/55 sm:flex`;

export const rail =
  `absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-1.5 rounded-2xl ${chrome} p-1.5 sm:flex`;

export const qualityBtn =
  'flex-1 rounded-lg border border-white/15 bg-[#121a2a] py-2 text-xs text-slate-100 transition-all hover:border-accent/50';

export const qualityBtnActive =
  'flex-1 rounded-lg border border-accent-bright/50 bg-gradient-to-b from-accent to-accent-dim py-2 text-xs font-bold text-white';

export const settingLabel =
  'mb-2 flex justify-between text-sm text-slate-200';

export const rangeInput = 'w-full accent-accent';

export const kbdStyle =
  'inline-block rounded-md border border-white/20 border-b-2 bg-[#0b1220] px-1.5 py-0.5 font-sans text-[10px] text-slate-100';

/** Compact bottom status strip (single bar, less view blocking). */
export const statusStrip =
  `pointer-events-none absolute bottom-3 left-1/2 z-20 flex max-w-[min(520px,76vw)] -translate-x-1/2 items-center gap-0 overflow-hidden rounded-full ${chrome} sm:bottom-10`;

export const statusStripItem =
  'flex flex-col items-center justify-center border-r border-white/10 px-2.5 py-1.5 last:border-r-0 sm:px-3';

/** Format settings.hour (0–24, half steps) as 12h clock. */
export function formatClock(hour) {
  if (hour == null || !Number.isFinite(hour)) return '—';
  const h = Math.floor(hour) % 24;
  const m = hour % 1 ? 30 : 0;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Rough weather label from 0–100 cloud/precip slider. */
export function formatWeatherLabel(weather, tempC) {
  const w = weather ?? 0;
  const sky = w >= 85 ? 'Rain' : w >= 55 ? 'Overcast' : w >= 25 ? 'Partly cloudy' : 'Clear sky';
  if (tempC != null && Number.isFinite(tempC)) return `${Math.round(tempC)}°C ${sky}`;
  return sky;
}
