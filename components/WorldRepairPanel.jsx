'use client';

import { useEffect, useState } from 'react';
import { AppIcon } from '@/components/AppIcon';

const riskClass = {
  low: 'border-emerald-300/25 bg-emerald-300/5 text-emerald-100',
  medium: 'border-amber-300/25 bg-amber-300/5 text-amber-100',
  high: 'border-rose-300/25 bg-rose-300/5 text-rose-100',
};

export function WorldRepairPanel({ onClose, lat, lon, place, summary }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/world-repair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lat, lon, place, summary }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Audit failed');
        return data;
      })
      .then(setResult)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, [lat, lon, place, summary]);

  return (
    <section className="absolute inset-x-3 bottom-3 top-20 z-50 ml-auto flex max-w-[430px] flex-col overflow-hidden rounded-[24px] border border-mint/25 bg-[#07111df2] text-slate-100 shadow-[0_28px_90px_rgba(0,0,0,.65)] backdrop-blur-xl sm:bottom-auto sm:right-4 sm:top-20 sm:max-h-[calc(100vh-6rem)]">
      <header className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-mint/25 bg-mint/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-mint">
            <AppIcon name="spark" className="h-3.5 w-3.5" /> World intelligence
          </div>
          <h2 className="font-display text-xl font-bold text-white">Local World Repair audit</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Suggestions are evidence-bound, reversible, and never written to source map data.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close AI World Repair" className="rounded-full border border-white/10 px-3 py-1.5 text-slate-300 hover:bg-white/10">×</button>
      </header>

      <div className="overflow-y-auto p-5">
        {!result && !error && (
          <div className="space-y-3" aria-live="polite">
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-white/10" />
            <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
            <p className="text-xs text-slate-500">Inspecting coverage, topology, and provenance…</p>
          </div>
        )}
        {error && <p className="rounded-2xl border border-rose-300/25 bg-rose-400/10 p-4 text-sm text-rose-100">{error}</p>}
        {result && (
          <>
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500">Inference path</div>
                <div className="mt-1 text-sm font-semibold text-white">Deterministic local inference</div>
              </div>
              <span className="rounded-full border border-mint/25 bg-mint/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-mint">{result.engine}</span>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-slate-300">{result.summary}</p>
            <div className="space-y-3">
              {result.findings.map((finding) => (
                <article key={finding.id} className={`rounded-2xl border p-4 ${riskClass[finding.risk] || riskClass.low}`}>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-white">{finding.title}</h3>
                    <span className="shrink-0 text-[10px] font-bold tabular-nums">{Math.round(finding.confidence * 100)}%</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">{finding.action}</p>
                  <p className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-slate-500">Evidence: {finding.evidence}</p>
                </article>
              ))}
            </div>
            {result.note && <p className="mt-4 text-[11px] leading-relaxed text-amber-200/80">{result.note}</p>}
            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Provenance</div>
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                {result.provenance.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
