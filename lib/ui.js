export const overlay =
  'absolute inset-0 z-40 flex items-center justify-center bg-gradient-to-b from-void-950/90 via-void/80 to-void-950/70 backdrop-blur-sm';

export const overlayDim = 'absolute inset-0 z-40 flex items-center justify-center bg-void-950/80 backdrop-blur-sm';

export const menuCard = 'animate-fade-up text-center px-8 py-10 sm:px-14';

export const menuTitle =
  'font-display mt-3 text-4xl sm:text-5xl font-extrabold tracking-[0.18em] bg-gradient-to-b from-white via-slate-100 to-slate-400 bg-clip-text text-transparent drop-shadow-[0_2px_24px_rgba(80,140,255,0.35)]';

export const menuTitleSm =
  'font-display text-3xl font-extrabold tracking-[0.15em] bg-gradient-to-b from-white to-slate-400 bg-clip-text text-transparent';

export const menuSub =
  'mt-2 text-xs sm:text-sm uppercase tracking-[0.22em] text-slate-400';

export const menuLogo = 'text-6xl sm:text-7xl drop-shadow-glow';

export const menuBtn =
  'w-64 max-w-[85vw] rounded-xl border border-white/15 bg-[rgba(18,26,42,0.95)] px-5 py-3.5 text-sm tracking-wide text-slate-100 shadow-[0_4px_20px_rgba(0,0,0,0.4)] transition-all duration-150 hover:-translate-y-0.5 hover:border-accent-bright/40 hover:bg-[#1a2438] disabled:cursor-wait disabled:opacity-50';

export const menuBtnPrimary =
  'w-64 max-w-[85vw] rounded-xl border border-accent-bright/40 bg-gradient-to-b from-accent to-accent-dim px-5 py-3.5 text-sm font-bold tracking-wide text-white shadow-lg shadow-accent/25 transition-all duration-150 hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-wait disabled:opacity-50';

// Opaque dark chrome — readable over bright sky / white buildings (not frosted glass)
// Z-INDEX LANES (keep every absolute element in its lane):
//   0     world canvas
//   10-20 in-world overlays (toasts pinned to gameplay, editor chrome)
//   30    persistent HUD bars (top bar, status strip, mode hints)
//   40-45 full-screen dims (loading, menu, big map)
//   50    modal panels (travel/settings/pause)
//   60    notifications (share toast) — nothing may sit above these
const chrome =
  'border border-black/40 bg-[rgba(11,18,32,0.92)] text-slate-100 shadow-[0_4px_24px_rgba(0,0,0,0.45)] backdrop-blur-md';

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
  `flex h-9 w-9 items-center justify-center rounded-xl ${chrome} text-sm text-slate-100 transition-all hover:border-accent-bright/50 hover:bg-[#152038] hover:text-white`;

export const toolbarBtnActive =
  'flex h-9 w-9 items-center justify-center rounded-xl border border-accent-bright/60 bg-[rgba(26,42,72,0.95)] text-sm text-white shadow-[0_4px_16px_rgba(0,0,0,0.4)]';

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
  `pointer-events-none absolute bottom-2 left-1/2 z-20 hidden max-w-[min(640px,70vw)] -translate-x-1/2 items-center gap-2 overflow-x-auto whitespace-nowrap rounded-full ${chrome} px-3 py-1 text-[10px] text-slate-300 sm:flex`;

export const topBar =
  'pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-2 pt-2 sm:gap-3 sm:px-4 sm:pt-3';

export const topBarInner =
  `pointer-events-auto flex items-center gap-2 rounded-xl ${chrome} px-2.5 py-1.5`;

export const searchField =
  `pointer-events-auto flex h-9 w-[min(280px,36vw)] items-center gap-2 rounded-full ${chrome} px-3 text-sm text-slate-100 transition-colors hover:border-accent/50 focus-within:border-accent-bright/60 sm:w-[min(340px,40vw)]`;

export const rail =
  `absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-1.5 rounded-2xl ${chrome} p-1.5 sm:flex sm:left-3`;

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
  `pointer-events-none absolute bottom-10 left-1/2 z-20 flex max-w-[min(560px,88vw)] -translate-x-1/2 items-center gap-0 overflow-hidden rounded-full ${chrome} sm:bottom-11`;

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
