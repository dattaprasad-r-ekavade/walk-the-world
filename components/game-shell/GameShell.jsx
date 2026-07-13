'use client';

import Minimap from '@/components/Minimap';
import {
  TravelPanel,
  SettingsPanel,
  PauseMenu,
  ControlsPanel,
  PassportPanel,
  WhereAmIPanel,
  travelBtnWide,
} from '@/components/hud/Panels';
import { MobileControls } from '@/components/MobileControls';
import { BrandLockup } from '@/components/Brand';
import { AppIcon } from '@/components/AppIcon';
import { WorldRepairPanel } from '@/components/WorldRepairPanel';
import {
  coordsPill,
  formatClock,
  formatWeatherLabel,
  hintBar,
  rail,
  searchField,
  statusStrip,
  statusStripItem,
  statusCardLabel,
  statusCardValue,
  topBar,
  topBarInner,
  toolbarBtn,
  toolbarBtnActive,
} from '@/lib/ui';

function formatElevation(m) {
  if (m === null || m === undefined) return '—';
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatCoord(v, pos, neg) {
  if (v === undefined || v === null || !isFinite(v)) return '';
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
}

function RailBtn({ title, active, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={active ? toolbarBtnActive : toolbarBtn}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusItem({ label, value, valueClass = '' }) {
  return (
    <div className={statusStripItem}>
      <div className={statusCardLabel}>{label}</div>
      <div className={`${statusCardValue} ${valueClass}`}>{value}</div>
    </div>
  );
}

export function GameShell({
  engine = 'cesium',
  screen,
  status,
  posRef,
  trailRef,
  panel,
  setPanel,
  bigMap,
  setBigMap,
  place,
  settings,
  onSettingChange,
  onTravel,
  savedPlaces,
  onSavePlace,
  onRemovePlace,
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
  photoMode = false,
  onShare,
  onPhotoMode,
  onPhotoCapture,
  passport,
  shareToast,
  whereAmI,
  onWhereAmIGuess,
  onWhereAmIClose,
  onWhereAmIAgain,
  onExportWalkCard,
  liveTemp,
  worldSummary,
  children,
}) {
  const lat = status.lat ?? coordsFallback?.lat;
  const lon = status.lon ?? coordsFallback?.lon;
  const fpsLow = status.fps > 0 && status.fps < 40;
  const showHud = screen === 'play' && !photoMode;
  const placeLabel = typeof place === 'string' ? place : place?.text;
  const developerMode = Boolean(settings?.developerMode);

  const openTravel = () => setPanel(panel === 'travel' ? null : 'travel');

  return (
    <>
      {children}

      {showHud && (
        <>
          {/* Top brand + search + actions */}
          <div className={topBar}>
            <div className={`${topBarInner} max-w-[112px] sm:max-w-none`}>
              <BrandLockup compact className="min-w-0" />
            </div>

            <button type="button" className={searchField} onClick={openTravel} title="Fast travel (M)">
              <span className="text-slate-500" aria-hidden>
                ⌕
              </span>
              <span className="truncate text-slate-400">
                {placeLabel || 'Search for a place…'}
              </span>
            </button>

            <div className={`${topBarInner} hidden gap-1.5 sm:flex`}>
              {worldSummary && (
                <button
                  type="button"
                  aria-label="AI World Repair audit"
                  title="AI World Repair audit"
                  className={panel === 'worldrepair' ? toolbarBtnActive : toolbarBtn}
                  onClick={() => setPanel(panel === 'worldrepair' ? null : 'worldrepair')}
                >
                  <AppIcon name="spark" />
                </button>
              )}
              <button
                type="button"
                title="Passport"
                aria-label="Passport"
                className={panel === 'passport' ? toolbarBtnActive : toolbarBtn}
                onClick={() => setPanel(panel === 'passport' ? null : 'passport')}
              >
                <AppIcon name="passport" />
              </button>
              {onShare && (
                <button type="button" title="Copy share link" aria-label="Copy share link" className={toolbarBtn} onClick={onShare}>
                  <AppIcon name="share" />
                </button>
              )}
              {onPhotoMode && (
                <button type="button" title="Photo mode (H)" aria-label="Photo mode" className={toolbarBtn} onClick={onPhotoMode}>
                  <AppIcon name="camera" />
                </button>
              )}
              <button
                type="button"
                title="Settings"
                aria-label="Settings"
                className={panel === 'settings' ? toolbarBtnActive : toolbarBtn}
                onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
              >
                <AppIcon name="settings" />
              </button>
            </div>
          </div>

          {/* Left icon rail */}
          <nav className={rail} aria-label="Main">
            <RailBtn title="Menu (P)" active={panel === 'pause'} onClick={() => setPanel(panel === 'pause' ? null : 'pause')}>
              <AppIcon name="menu" />
            </RailBtn>
            <RailBtn title="Fast travel (M)" active={panel === 'travel'} onClick={openTravel}>
              <AppIcon name="map" />
            </RailBtn>
            <RailBtn title="Expand map (Tab)" active={bigMap} onClick={() => setBigMap((b) => !b)}>
              <AppIcon name="compass" />
            </RailBtn>
            <RailBtn title="Passport" active={panel === 'passport'} onClick={() => setPanel(panel === 'passport' ? null : 'passport')}>
              <AppIcon name="passport" />
            </RailBtn>
            <RailBtn title="Globe view" onClick={onGoHome}>
              <AppIcon name="globe" />
            </RailBtn>
            <RailBtn title="Settings" active={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>
              <AppIcon name="settings" />
            </RailBtn>
            {worldSummary && (
              <RailBtn title="AI World Repair" active={panel === 'worldrepair'} onClick={() => setPanel(panel === 'worldrepair' ? null : 'worldrepair')}>
                <AppIcon name="spark" />
              </RailBtn>
            )}
            {engine === 'cesium' && (
              <>
                <RailBtn title="First/third person (V)" onClick={onToggleView}>
                  {status.view === 'third' ? '👁' : '👤'}
                </RailBtn>
                {walking && (
                  <RailBtn title="Street Engine" onClick={onStreetEngine}>
                    🎮
                  </RailBtn>
                )}
                <RailBtn title="Toggle walk/fly (F)" onClick={onToggleWalk}>
                  {walking ? '✈' : '🚶'}
                </RailBtn>
              </>
            )}
          </nav>

          {/* Mobile fallback toolbar (rail is sm+) */}
          <div className="absolute left-2 top-[4.25rem] z-20 flex flex-col gap-2 sm:hidden">
            <RailBtn title="Menu" active={panel === 'pause'} onClick={() => setPanel(panel === 'pause' ? null : 'pause')}>
              <AppIcon name="menu" />
            </RailBtn>
            <RailBtn title="Travel" active={panel === 'travel'} onClick={openTravel}>
              <AppIcon name="map" />
            </RailBtn>
          </div>

          <div className="pointer-events-auto absolute right-2 top-2 z-30 flex gap-1.5 sm:hidden">
            {worldSummary && (
              <button type="button" aria-label="AI World Repair" className={panel === 'worldrepair' ? toolbarBtnActive : toolbarBtn} onClick={() => setPanel(panel === 'worldrepair' ? null : 'worldrepair')}>
                <AppIcon name="spark" />
              </button>
            )}
            <button type="button" aria-label="Settings" className={panel === 'settings' ? toolbarBtnActive : toolbarBtn} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}>
              <AppIcon name="settings" />
            </button>
          </div>

          {/* Minimap + coords — compact, corner only */}
          <div className="pointer-events-auto absolute right-2 top-[4.25rem] z-20 flex flex-col items-end gap-1 sm:right-3 sm:top-[4.5rem]">
            <button
              type="button"
              className="hidden rounded-full border border-white/10 bg-[rgba(6,15,25,0.88)] p-0.5 shadow-[0_8px_28px_rgba(0,0,0,0.48)] transition-transform hover:scale-[1.02] sm:block"
              title="Expand map (Tab)"
              onClick={() => setBigMap(true)}
            >
              <Minimap
                lat={lat}
                lon={lon}
                heading={status.heading}
                height={status.height}
                posRef={posRef}
                trailRef={trailRef}
                trail={passport?.trail}
                size={128}
              />
            </button>
            <button type="button" className="rounded-full border border-white/10 bg-[rgba(6,15,25,.9)] p-0.5 shadow-xl sm:hidden" aria-label="Open minimap" onClick={() => setBigMap(true)}>
              <Minimap lat={lat} lon={lon} heading={status.heading} height={status.height} posRef={posRef} trailRef={trailRef} trail={passport?.trail} size={86} />
            </button>
            <div className={`${coordsPill} hidden sm:block`}>
              {formatCoord(lat, 'N', 'S')} · {formatCoord(lon, 'E', 'W')}
            </div>
          </div>

          {/* Bottom status — one compact strip, not five cards */}
          <div className="hidden sm:block">
            <div ref={hudRef} className={statusStrip}>
              <StatusItem label="Mode" value={modeLabel || '—'} />
              {developerMode && (
                <>
                  <StatusItem label="Alt" value={formatElevation(status.elevation ?? (status.height ? Math.round(status.height) : null))} />
                  <StatusItem label="FPS" value={status.fps > 0 ? String(status.fps) : '—'} valueClass={fpsLow ? 'text-amber-300' : 'text-mint'} />
                </>
              )}
              <StatusItem label="Local time" value={formatClock(settings?.hour)} />
              <StatusItem label="Weather" value={formatWeatherLabel(settings?.weather, liveTemp)} />
            </div>
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
                trailRef={trailRef}
                trail={passport?.trail}
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
              className="pointer-events-none absolute bottom-[5.5rem] right-3 z-20 max-w-[42vw] animate-loc-toast rounded-lg border border-black/40 bg-[rgba(11,18,32,0.88)] px-2.5 py-1 text-right font-display text-sm font-bold tracking-wide text-white shadow-[0_4px_16px_rgba(0,0,0,0.45)] sm:bottom-24 sm:right-4 sm:text-base"
              key={place.key ?? place}
            >
              {place.text ?? place}
            </div>
          )}
        </>
      )}

      {photoMode && screen === 'play' && !whereAmI && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex flex-col items-center gap-2">
          <p className="rounded-full border border-black/40 bg-[rgba(11,18,32,0.92)] px-4 py-1.5 text-xs text-slate-100 shadow-[0_4px_16px_rgba(0,0,0,0.45)]">
            Photo mode · Esc or H to exit
            {onPhotoCapture ? ' · click 📸 to save' : ''}
          </p>
          {onPhotoCapture && (
            <button
              type="button"
              className="pointer-events-auto rounded-full border border-white/20 bg-slate-950/85 px-5 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-slate-800"
              onClick={onPhotoCapture}
            >
              📸 Save screenshot
            </button>
          )}
        </div>
      )}

      {whereAmI && !whereAmI.revealed && screen === 'play' && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center">
          <p className="rounded-full border border-black/40 bg-[rgba(11,18,32,0.92)] px-4 py-1.5 text-xs text-slate-200 shadow-[0_4px_16px_rgba(0,0,0,0.45)] backdrop-blur">
            Where am I? · look around · pick a city below
          </p>
        </div>
      )}

      {shareToast && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-[60] -translate-x-1/2 rounded-full border border-emerald-400/30 bg-emerald-950/90 px-4 py-1.5 text-xs text-emerald-100 shadow-lg backdrop-blur">
          {shareToast}
        </div>
      )}

      {panel === 'travel' && (
        <TravelPanel
          onClose={() => setPanel(null)}
          onTravel={onTravel}
          savedPlaces={savedPlaces}
          onSavePlace={onSavePlace}
          onRemovePlace={onRemovePlace}
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

      {panel === 'passport' && (
        <PassportPanel
          passport={passport}
          place={placeLabel}
          onClose={() => setPanel(null)}
          onExportCard={onExportWalkCard}
        />
      )}

      {panel === 'worldrepair' && worldSummary && (
        <WorldRepairPanel
          onClose={() => setPanel(null)}
          lat={lat}
          lon={lon}
          place={placeLabel}
          summary={worldSummary}
        />
      )}

      {panel === 'whereami' && whereAmI && (
        <WhereAmIPanel
          round={whereAmI}
          onGuess={onWhereAmIGuess}
          onClose={onWhereAmIClose}
          onPlayAgain={onWhereAmIAgain}
        />
      )}

      {panel === 'pause' && screen === 'play' && <PauseMenu buttons={pauseButtons} />}

      {showHud && <MobileControls enabled={!photoMode} />}
    </>
  );
}
