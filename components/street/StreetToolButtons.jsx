"use client";

const modeButton = (active, activeClass) => `rounded-xl border px-3 py-2 text-xs font-semibold backdrop-blur transition-colors ${
  active ? activeClass : "border-white/15 bg-slate-950/70 text-slate-200 hover:bg-slate-800/80"
}`;

/** Bottom-right buttons: editor and tag inspector (developer mode) plus sound. */
export function StreetToolButtons({ engine, developerMode, uiMode, muted }) {
  return (
    <div className="absolute bottom-32 right-4 z-20 flex flex-col items-end gap-2">
      {developerMode && (
        <button
          type="button"
          onClick={() => engine.current.setMode?.("editor")}
          className={modeButton(uiMode === "editor", "border-emerald-400 bg-emerald-500/80 text-black")}
          title="Map editor (E): place assets, sculpt terrain, hide broken features"
        >
          Edit <kbd className="ml-1 opacity-60">E</kbd>
        </button>
      )}
      <button
        type="button"
        onClick={() => engine.current.toggleMute?.()}
        className="hidden rounded-xl border border-white/10 bg-slate-950/75 px-3 py-2 text-[11px] font-semibold text-slate-300 backdrop-blur hover:bg-slate-800/80 sm:block"
        title="Ambient sound on/off"
      >
        {muted ? "Sound off" : "Sound on"}
      </button>
      {developerMode && (
        <button
          type="button"
          onClick={() => engine.current.setMode?.("debug")}
          className={modeButton(uiMode === "debug", "border-sky-400 bg-sky-500/80 text-black")}
          title="OSM tag inspector (B): click features to view/fix their tags"
        >
          Map data <kbd className="ml-1 opacity-60">B</kbd>
        </button>
      )}
    </div>
  );
}

/** Small pill shown while city cells stream in behind a walkable world. */
export function StreamingToast({ text }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-28 z-20 max-w-[70vw] -translate-x-1/2 whitespace-nowrap rounded-full border border-mint/20 bg-[rgba(6,15,25,0.9)] px-4 py-1.5 text-[11px] text-slate-300 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur sm:bottom-24 sm:top-auto sm:text-xs">
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" />
      {text}
    </div>
  );
}
