'use client';

// Asset Library — upload GLB models to R2, then place them in the world via
// the street engine's edit mode (E key at any location).
import { useEffect, useState } from 'react';
import { useGameStore } from '@/stores/game-store';

export default function EditorPage() {
  const [assets, setAssets] = useState([]);
  const [status, setStatus] = useState('');
  const [editorKey, setEditorKey] = useState('');
  const [mounted, setMounted] = useState(false);
  const lastPosition = useGameStore((s) => s.lastPosition);
  const savedPlaces = useGameStore((s) => s.savedPlaces);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setEditorKey(localStorage.getItem('wtw_editor_key') || '');
    refresh();
  }, []);

  const refresh = () =>
    fetch('/api/assets').then((r) => r.json()).then((d) => Array.isArray(d) && setAssets(d)).catch(() => {});

  const saveKey = (v) => {
    setEditorKey(v);
    localStorage.setItem('wtw_editor_key', v);
  };

  const upload = async (file) => {
    if (!file) return;
    setStatus(`Uploading ${file.name}…`);
    const res = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'x-editor-key': editorKey },
      body: file,
    });
    const d = await res.json();
    setStatus(res.ok ? `✓ ${file.name} uploaded` : `✗ ${d.error || res.status}`);
    refresh();
  };

  return (
    <main className="min-h-screen bg-[#05070d] p-8 text-slate-100">
      <h1 className="text-2xl font-bold">🧰 Asset Library</h1>
      <p className="mt-1 text-sm text-slate-400">GLB models stored in R2 — this page only manages uploads.</p>

      <div className="mt-4 max-w-xl rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-sm leading-relaxed">
        <p className="font-semibold text-emerald-300">The editor itself lives in the world:</p>
        <p className="mt-1 text-slate-300">
          Walk anywhere in the street engine and press <kbd className="rounded bg-slate-800 px-1.5">E</kbd> — place
          assets, raise/lower/flatten terrain, hide broken OSM features. Press{' '}
          <kbd className="rounded bg-slate-800 px-1.5">B</kbd> to inspect and fix OSM tags.
        </p>
        {mounted && (
          <div className="mt-3 flex flex-wrap gap-2">
            {lastPosition && (
              <a
                className="rounded-lg bg-emerald-500/80 px-3 py-1.5 font-semibold text-black hover:bg-emerald-400"
                href={`/street?lat=${lastPosition.lat.toFixed(5)}&lon=${lastPosition.lon.toFixed(5)}`}
              >
                ▶ Continue where you left off
              </a>
            )}
            {(savedPlaces || []).map((pl) => (
              <a
                key={pl.name}
                className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20"
                href={`/street?lat=${pl.lat.toFixed(5)}&lon=${pl.lon.toFixed(5)}`}
              >
                ★ {pl.name}
              </a>
            ))}
            {!lastPosition && (
              <a className="rounded-lg bg-white/10 px-3 py-1.5 hover:bg-white/20" href="/street">
                Open street engine
              </a>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 max-w-xl rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <label className="block text-sm text-slate-400">Editor key (from EDITOR_SECRET in .env.local)</label>
        <input
          type="password"
          value={editorKey}
          onChange={(e) => saveKey(e.target.value)}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"
          placeholder="wtw-editor-…"
        />
        <label className="mt-4 block text-sm text-slate-400">Upload .glb</label>
        <input
          type="file"
          accept=".glb,.gltf"
          onChange={(e) => upload(e.target.files?.[0])}
          className="mt-1 block text-sm"
        />
        {status && <p className="mt-2 text-sm text-amber-300">{status}</p>}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Library ({assets.length})</h2>
      <div className="mt-3 grid max-w-3xl grid-cols-1 gap-2 sm:grid-cols-2">
        {assets.map((a) => (
          <div key={a.name} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
            <div>
              <div className="text-sm font-medium">{a.name}</div>
              <div className="text-xs text-slate-500">{(a.size / 1024).toFixed(0)} KB</div>
            </div>
            <a className="text-xs text-blue-400 underline" href={a.url} target="_blank" rel="noreferrer">raw</a>
          </div>
        ))}
        {!assets.length && <p className="text-sm text-slate-500">No assets yet — upload a .glb above.</p>}
      </div>
    </main>
  );
}
