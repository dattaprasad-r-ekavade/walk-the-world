"use client";

import { useState } from "react";

const toolBtnPrimary = "rounded bg-emerald-500/80 px-2 py-1 font-semibold text-black hover:bg-emerald-400";

const tagsToText = (tags) => Object.entries(tags || {}).map(([k, v]) => `${k}=${v}`).join("\n");

function parseTags(text) {
  const tags = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) tags[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return tags;
}

/** Editable tag list for one picked feature. Remounted per feature (keyed by id). */
function TagEditor({ engine, selection, onSaved }) {
  const [draft, setDraft] = useState(() => tagsToText(selection.tags));
  const save = async () => {
    const tags = parseTags(draft);
    const ok = await engine.current.editorApi?.setTagOverride(selection.id, tags);
    onSaved({ ...selection, tags, saved: ok ? "override saved to R2 ✓ (applied on reload)" : "save failed — set editor key in E panel" });
  };
  return (
    <>
      <div className="mb-1 font-mono text-amber-300">
        {selection.kind} · {selection.id}
      </div>
      <textarea
        rows={8}
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        spellCheck={false}
        className="w-full rounded bg-black/40 p-2 font-mono outline-none ring-1 ring-white/10 focus:ring-accent"
      />
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={toolBtnPrimary} onClick={save}>💾 Save override</button>
        <a
          className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
          href={`https://www.openstreetmap.org/edit?${selection.id.replace("/", "=")}`}
          target="_blank"
          rel="noreferrer"
        >
          Edit on OSM ↗
        </a>
      </div>
      {selection.saved && <div className="mt-2 text-emerald-300">{selection.saved}</div>}
      <div className="mt-2 text-slate-500">Overrides are local (stored in R2), merged over OSM data on reload.</div>
    </>
  );
}

/** OSM tag inspector (B): click a feature to view and override its tags. */
export function DebugPanel({ engine, selection, onSelectionChange }) {
  return (
    <div className="absolute left-4 top-16 z-20 w-80 rounded-xl border border-white/10 bg-slate-950/90 p-4 text-xs text-slate-200 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold tracking-wide">🔍 OSM DEBUG</span>
        <button type="button" className="text-slate-400 hover:text-white" onClick={() => engine.current.setMode?.("debug")}>✕</button>
      </div>
      {!selection && <div className="text-slate-400">Click a building or road to inspect its OSM tags.</div>}
      {selection?.kind === "none" && <div className="text-slate-400">Nothing with OSM data there.</div>}
      {selection?.id && (
        <TagEditor key={selection.id} engine={engine} selection={selection} onSaved={onSelectionChange} />
      )}
      <div className="mt-2 text-slate-500">✈ Scroll zoom · MMB orbit · Shift+MMB pan · RMB look · WASD fly · B exit</div>
    </div>
  );
}
