"use client";

import { useState } from "react";

const toolBtn = "rounded bg-white/10 px-2 py-1 hover:bg-white/20";
const toolBtnPrimary = "rounded bg-emerald-500/80 px-2 py-1 font-semibold text-black hover:bg-emerald-400";

function readEditorKey() {
  try {
    return localStorage.getItem("wtw_editor_key") || "";
  } catch {
    return "";
  }
}

/** Map editor panel (E): tools, brush size, asset library and save. */
export function EditorPanel({ engine, assets, message }) {
  const [brushRadius, setBrushRadius] = useState(12);
  const [hasKey, setHasKey] = useState(() => !!readEditorKey());
  const api = () => engine.current.editorApi;
  const tool = (t) => api()?.setTool(t);

  return (
    <div className="absolute left-4 top-16 z-20 w-72 rounded-xl border border-white/10 bg-slate-950/90 p-4 text-xs text-slate-200 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold tracking-wide">🛠 MAP EDITOR</span>
        <button type="button" className="text-slate-400 hover:text-white" onClick={() => engine.current.setMode?.("editor")}>✕</button>
      </div>
      <input
        type="password"
        placeholder="editor key (needed only to Save)"
        defaultValue={readEditorKey()}
        onChange={(ev) => {
          api()?.setEditorKey(ev.target.value);
          setHasKey(!!ev.target.value);
        }}
        className="mb-2 w-full rounded bg-black/40 px-2 py-1 outline-none ring-1 ring-white/10 focus:ring-accent"
      />
      {!hasKey && (
        <p className="mb-2 text-[11px] leading-snug text-amber-300/90">
          You can explore every tool without a key — it&apos;s only required to 💾 Save.
          The key is the EDITOR_SECRET env var of this deployment.
        </p>
      )}
      <div className="mb-2 grid grid-cols-3 gap-1">
        <button type="button" className={toolBtn} onClick={() => tool(null)}><kbd className="mr-1 opacity-50">1</kbd>Select</button>
        <button type="button" className={toolBtn} onClick={() => tool({ type: "flatten", radius: brushRadius })}><kbd className="mr-1 opacity-50">2</kbd>Flatten</button>
        <button type="button" className={toolBtn} onClick={() => tool({ type: "raise", radius: brushRadius })}><kbd className="mr-1 opacity-50">3</kbd>Raise</button>
        <button type="button" className={toolBtn} onClick={() => tool({ type: "lower", radius: brushRadius })}><kbd className="mr-1 opacity-50">4</kbd>Lower</button>
        <button type="button" className={toolBtn} onClick={() => tool({ type: "hide" })}><kbd className="mr-1 opacity-50">5</kbd>Hide</button>
        <button type="button" className={toolBtnPrimary} onClick={() => api()?.save()}>💾 Save</button>
      </div>
      <label className="mb-2 flex items-center gap-2 text-slate-400">
        brush
        <input
          type="range"
          min={4}
          max={60}
          value={brushRadius}
          onChange={(ev) => setBrushRadius(Number(ev.target.value))}
          className="flex-1"
        />
        {brushRadius}m
      </label>
      <div className="mb-2 flex gap-1">
        <button type="button" className={toolBtn} onClick={() => api()?.clearHidden()}>Unhide all</button>
        <button type="button" className={toolBtn} onClick={() => api()?.clearTerrain()}>Reset terrain</button>
      </div>
      <div className="mb-1 text-slate-400">Assets — click to arm, then click the ground:</div>
      <div className="max-h-40 space-y-1 overflow-auto">
        {assets.map((a) => (
          <button
            type="button"
            key={a.name}
            className="block w-full truncate rounded bg-white/5 px-2 py-1 text-left hover:bg-white/15"
            onClick={() => tool({ type: "asset", name: a.name, url: a.url })}
          >
            📦 {a.name}
          </button>
        ))}
        {assets.length === 0 && (
          <div className="text-slate-500">no assets yet — upload .glb files at <span className="font-mono">/editor</span></div>
        )}
      </div>
      {message && <div className="mt-2 text-emerald-300">{message}</div>}
      <div className="mt-2 space-y-0.5 text-slate-500">
        <div>✈ Scroll zoom · MMB orbit · Shift+MMB pan · RMB look · WASD fly · Space/C up/down</div>
        <div>1-5 tools · click to apply · Ctrl+Z undo · Esc deselect · E exit</div>
        <div>Selected asset: G move · R rotate · [ ] scale · X delete</div>
        <div>Hover shows what you&apos;d pick; Hide removes OSM features on reload.</div>
      </div>
    </div>
  );
}
