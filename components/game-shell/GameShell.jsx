'use client';

import Minimap from '@/components/Minimap';
import {
  TravelPanel,
  SettingsPanel,
  PauseMenu,
  ControlsPanel,
  travelBtnWide,
} from '@/components/hud/Panels';
import { MobileControls } from '@/components/MobileControls';
import {
  coordsPill,
  hintBar,
  hudChip,
  hudChipMode,
  toolbarBtn,
} from '@/lib/ui';

function formatElevation(m) {
  if (m === null || m === undefined) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`;
}

function formatCoord(v, pos, neg) {
  if (v === undefined || v === null || !isFinite(v)) return '';
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
}

export function GameShell({
  engine = 'cesium',
  screen,
  status,
  posRef,
  panel,
  setPanel,
  bigMap,
  setBigMap,
  place,
  settings,
  onSettingChange,
  onTravel,
  onGoHome,
  onToggleWalk,
  onToggleView,
  onStreetEngine,
  onGeolocation,
  geoBusy,
  walking,
  settingsExtra,
  pauseButtons,
  coordsFallback,
  modeLabel,
  hintText,
  hudRef,
  children,
}) {
  const lat = status.lat ?? coordsFallback?.lat;
  const lon = status.lon ?? coordsFallback?.lon;
  const fpsLow = status.fps > 0 && status.fps < 40;

  return (
    <>
      {children}

      {screen === 'play' && (
        <>
          <div className="absolute right-4 top-4 z-20 flex flex-col items-center gap-1.5 sm:right-5 sm:top-5">
            <Minimap
              lat={lat}
              lon={lon}
              heading={status.heading}
              height={status.height}
              posRef={posRef}
            />
            <div className={coordsPill}>
              {formatCoord(lat, 'N', 'S')} · {formatCoord(lon, 'E', 'W')}
            </div>
          </div>

          <div className="absolute left-4 top-4 z-20 flex flex-col gap-2 sm:left-5 sm:top-5">
            <button type="button" title="Menu (P)" className={toolbarBtn} onClick={() => setPanel(panel === 'pause' ? null : 'pause')}>
              ☰
            </button>
            <button type="button" title="Fast travel (M)" className={toolbarBtn} onClick={() => setPanel(panel === 'travel' ? null : 'travel')}>
              🗺
            </button>
            <button type="button" title="Globe view" className={toolbarBtn} onClick={onGoHome}>
              🌐
            </button>
            <button type="button" title="Settings" className={toolbarBtn} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>
              ⚙
            </button>
            {engine === 'cesium' && (
              <>
                <button type="button" title="First/third person (V)" className={toolbarBtn} onClick={onToggleView}>
                  {status.view === 'third' ? '👁' : '👤'}
                </button>
                {walking && (
                  <button type="button" title="Street Engine" className={toolbarBtn} onClick={onStreetEngine}>
                    🎮
                  </button>
                )}
                <button type="button" title="Toggle walk/fly (F)" className={toolbarBtn} onClick={onToggleWalk}>
                  {walking ? '✈' : '🚶'}
                </button>
              </>
            )}
          </div>

          <div ref={hudRef} className="absolute bottom-4 left-4 z-20 flex flex-wrap gap-2 sm:bottom-5 sm:left-5">
            <span className={hudChipMode}>{modeLabel}</span>
            <span className={hudChip} data-hud-elev>
              ⛰ {formatElevation(status.elevation ?? (status.height ? Math.round(status.height) : null))}
            </span>
            <span
              className={`${hudChip} ${fpsLow ? 'text-amber-300' : 'text-sky-300'}`}
              data-hud-fps
            >
              {status.fps > 0 ? `${status.fps} FPS` : ''}
            </span>
          </div>

          <div className={hintBar} data-hud-hint>
            {hintText}
          </div>

          {bigMap && (
            <div
              className="absolute inset-0 z-[45] flex cursor-pointer flex-col items-center justify-center gap-3 bg-void-950/75 backdrop-blur-sm"
              onClick={() => setBigMap(false)}
            >
              <Minimap
                lat={lat}
                lon={lon}
                heading={status.heading}
                height={status.height}
                posRef={posRef}
                size={Math.min(560, typeof window !== 'undefined' ? window.innerHeight - 160 : 560)}
                zoomBias={-1}
              />
              <div className={coordsPill}>
                {formatCoord(lat, 'N', 'S')} · {formatCoord(lon, 'E', 'W')} · Tab to close
              </div>
            </div>
          )}

          {walking && status.locked && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_2px_rgba(0,0,0,0.45),0_0_10px_rgba(255,255,255,0.5)]" />
          )}
          {walking && place && (
            <div
              className="pointer-events-none absolute bottom-16 right-6 z-20 max-w-[70vw] animate-loc-toast text-right font-display text-2xl font-extrabold italic tracking-wide text-transparent bg-gradient-to-b from-white to-slate-400 bg-clip-text drop-shadow-[0_2px_3px_rgba(0,0,0,0.85)] sm:text-3xl"
              key={place.key ?? place}
            >
              {place.text ?? place}
            </div>
          )}
        </>
      )}

      {panel === 'travel' && (
        <TravelPanel
          onClose={() => setPanel(null)}
          onTravel={onTravel}
          extraTop={
            onGeolocation ? (
              <button type="button" className={travelBtnWide} onClick={onGeolocation} disabled={geoBusy}>
                {geoBusy ? '⏳ Locating…' : '📍 My Location'}
              </button>
            ) : null
          }
        />
      )}

      {panel === 'settings' && (
        <SettingsPanel settings={settings} onChange={onSettingChange} onClose={() => setPanel(null)}>
          {settingsExtra}
        </SettingsPanel>
      )}

      {panel === 'controls' && <ControlsPanel onClose={() => setPanel(null)} />}

      {panel === 'pause' && screen === 'play' && <PauseMenu buttons={pauseButtons} />}

      {screen === 'play' && <MobileControls />}
    </>
  );
}
