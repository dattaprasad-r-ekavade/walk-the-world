'use client';

import { PLACES } from '@/lib/geo';
import {
  glassPanel,
  menuBtn,
  menuBtnPrimary,
  menuCard,
  menuLogo,
  menuSub,
  menuTitle,
  menuTitleSm,
  overlay,
  overlayDim,
  panelClose,
  panelHead,
  panelTitle,
  qualityBtn,
  qualityBtnActive,
  rangeInput,
  settingLabel,
  travelBtn,
  travelBtnWide,
  kbdStyle,
} from '@/lib/ui';

export function LoadingScreen({ logo = '🌍', title = 'WALK THE WORLD', pct, stage }) {
  return (
    <div className={`${overlay} z-50`}>
      <div className={menuCard}>
        <div className={menuLogo}>{logo}</div>
        <h1 className={title.length > 14 ? menuTitle : menuTitleSm}>{title}</h1>
        <div className="mx-auto mt-8 h-2 w-72 max-w-[85vw] overflow-hidden rounded-full border border-accent/30 bg-accent/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-bright transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">{stage}</p>
      </div>
    </div>
  );
}

export function TravelPanel({
  onTravel,
  onClose,
  extraTop = null,
  savedPlaces = [],
  onSavePlace,
  onRemovePlace,
}) {
  return (
    <div className={glassPanel}>
      <div className={panelHead}>
        <h2 className={panelTitle}>🗺 Fast Travel</h2>
        <button type="button" className={panelClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {extraTop}
        {onSavePlace && (
          <button type="button" className={travelBtnWide} onClick={onSavePlace}>
            ☆ Save current location
          </button>
        )}
        {savedPlaces.map((p) => (
          <div key={p.name} className="relative">
            <button
              type="button"
              className={`${travelBtn} w-full pr-8`}
              onClick={() => onTravel(p.lat, p.lon)}
            >
              <span className="mr-1">★</span>
              {p.name}
            </button>
            {onRemovePlace && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-red-400"
                onClick={() => onRemovePlace(p.name)}
                aria-label={`Delete ${p.name}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {PLACES.map((p) => (
          <button key={p.name} type="button" className={travelBtn} onClick={() => onTravel(p.lat, p.lon)}>
            <span className="mr-1">📍</span>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPanel({ settings, onChange, onClose, children }) {
  return (
    <div className={glassPanel}>
      <div className={panelHead}>
        <h2 className={panelTitle}>⚙ Settings</h2>
        <button type="button" className={panelClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="mb-4">
        <label className={settingLabel}>
          <span>🕐 Time of day</span>
          <span className="tabular-nums text-slate-400">
            {String(Math.floor(settings.hour)).padStart(2, '0')}:
            {settings.hour % 1 ? '30' : '00'}
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="23.5"
          step="0.5"
          value={settings.hour}
          className={rangeInput}
          onChange={(e) => onChange({ hour: parseFloat(e.target.value) })}
        />
      </div>
      <div className="mb-4">
        <label className={settingLabel}>
          <span>🌦 Weather</span>
          <span className="text-slate-400">
            {settings.weather < 25
              ? 'Clear'
              : settings.weather < 55
                ? 'Hazy'
                : settings.weather < 85
                  ? 'Overcast'
                  : 'Heavy fog'}
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={settings.weather}
          className={rangeInput}
          onChange={(e) => onChange({ weather: parseInt(e.target.value, 10) })}
        />
      </div>
      {children}
      <div className="mb-4">
        <label className={settingLabel}>
          <span>🗺 Ground map</span>
        </label>
        <div className="flex gap-2">
          {[
            ['osm', 'OSM'],
            ['satellite', 'Satellite'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={(settings.groundSource || 'osm') === id ? qualityBtnActive : qualityBtn}
              onClick={() => onChange({ groundSource: id })}
            >
              {label}
            </button>
          ))}
        </div>
        {(settings.groundSource || 'osm') === 'satellite' && (
          <p className="mt-1.5 text-[11px] text-slate-500">Imagery © Esri — non-commercial use</p>
        )}
      </div>
      <div className="mb-4">
        <label className={settingLabel}>
          <span>🎵 Ambient music</span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className={settings.music !== false ? qualityBtnActive : qualityBtn}
            onClick={() => onChange({ music: true })}
          >
            On
          </button>
          <button
            type="button"
            className={settings.music === false ? qualityBtnActive : qualityBtn}
            onClick={() => onChange({ music: false })}
          >
            Off
          </button>
        </div>
      </div>
      <div>
        <label className={settingLabel}>
          <span>🖥 Quality</span>
          {settings.qualityMode === 'auto' && (
            <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-slate-500">auto</span>
          )}
        </label>
        <div className="flex gap-2">
          {['low', 'medium', 'high'].map((q) => (
            <button
              key={q}
              type="button"
              className={settings.quality === q ? qualityBtnActive : qualityBtn}
              onClick={() => onChange({ quality: q, qualityMode: 'manual' })}
            >
              {q[0].toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          High enables SSAO + bloom. Auto picks a tier from your GPU on first load.
        </p>
      </div>
    </div>
  );
}

export function PauseMenu({ title = 'PAUSED', buttons }) {
  return (
    <div className={overlayDim}>
      <div className={menuCard}>
        <h1 className={menuTitleSm}>{title}</h1>
        <div className="mt-8 flex flex-col items-center gap-3">
          {buttons.map(({ label, primary, onClick }) => (
            <button
              key={label}
              type="button"
              className={primary ? menuBtnPrimary : menuBtn}
              onClick={onClick}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ControlsPanel({ onClose }) {
  const rows = [
    ['Double-click', 'Land anywhere & start walking'],
    ['W A S D', 'Walk / fly'],
    ['Mouse', 'Look around (walk mode)'],
    ['Shift', 'Sprint'],
    ['V', 'First / third person'],
    ['F', 'Toggle walk / fly'],
    ['H', 'Photo mode (hide HUD · free look)'],
    ['C', 'Enter / exit nearby traffic car'],
    ['M', 'Fast travel map'],
    ['Tab', 'Expand / collapse the map'],
    ['N', 'Show current location name'],
    ['P', 'Pause menu'],
    ['Esc', 'Release mouse / exit photo mode'],
    ['Touch', 'Left joystick move · right side look · RUN sprint'],
  ];

  return (
    <div className={glassPanel}>
      <div className={panelHead}>
        <h2 className={panelTitle}>🎮 Controls</h2>
        <button type="button" className={panelClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <table className="w-full text-sm text-slate-300">
        <tbody>
          {rows.map(([key, desc]) => (
            <tr key={key} className="border-b border-accent/10">
              <td className="w-[42%] py-2 pr-2">
                <kbd className={kbdStyle}>{key}</kbd>
              </td>
              <td className="py-2 text-slate-400">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PassportPanel({ passport, onClose, onExportCard, place }) {
  const cities = Object.entries(passport?.cities || {}).sort((a, b) => b[1].km - a[1].km);
  const totalKm = passport?.totalKm || 0;
  const elev = Math.round(passport?.elevClimbed || 0);
  const countries = Object.keys(passport?.countries || {}).length;

  return (
    <div className={glassPanel}>
      <div className={panelHead}>
        <h2 className={panelTitle}>🛂 Passport</h2>
        <button type="button" className={panelClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-300">
        Walked <span className="font-semibold text-white tabular-nums">{totalKm.toFixed(2)} km</span>
        {elev > 0 && (
          <> · climbed <span className="tabular-nums text-white">{elev} m</span></>
        )}
        {cities.length > 0 && (
          <> · <span className="tabular-nums">{cities.length}</span> place{cities.length === 1 ? '' : 's'}</>
        )}
        {countries > 0 && (
          <> · <span className="tabular-nums">{countries}</span> countr{countries === 1 ? 'y' : 'ies'}</>
        )}
      </p>
      {onExportCard && (
        <button
          type="button"
          className={`${travelBtn} mb-4 w-full`}
          onClick={() => onExportCard(passport, place)}
        >
          🪪 Export walk card
        </button>
      )}
      {cities.length === 0 ? (
        <p className="text-sm text-slate-500">Start walking — distance and stamps save on this device.</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-auto text-sm">
          {cities.map(([name, s]) => (
            <li
              key={name}
              className="flex items-center justify-between gap-3 rounded-lg border border-accent/15 bg-black/20 px-3 py-2"
            >
              <span className="truncate text-slate-200">
                <span className="mr-1.5">📍</span>
                {name}
              </span>
              <span className="shrink-0 tabular-nums text-slate-400">
                {s.km < 0.1 ? `${Math.round(s.km * 1000)} m` : `${s.km.toFixed(2)} km`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WhereAmIPanel({ round, onGuess, onClose, onPlayAgain }) {
  if (!round) return null;
  return (
    <div className={glassPanel}>
      <div className={panelHead}>
        <h2 className={panelTitle}>🎲 Where am I?</h2>
        <button type="button" className={panelClose} onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {!round.revealed ? (
        <>
          <p className="mb-3 text-sm text-slate-400">
            Look around — HUD is hidden. Guess the city from what you see.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {round.options.map((name) => (
              <button
                key={name}
                type="button"
                className={travelBtn}
                onClick={() => onGuess(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3 text-sm">
          <p className={round.correct ? 'text-emerald-300' : 'text-amber-200'}>
            {round.correct ? '✓ Correct!' : `✗ It was ${round.answer}`}
          </p>
          <p className="text-slate-400">Walk around or play another round.</p>
          <div className="flex flex-col gap-2">
            {onPlayAgain && (
              <button type="button" className={travelBtnWide} onClick={onPlayAgain}>
                🎲 Play again
              </button>
            )}
            <button type="button" className={travelBtnWide} onClick={onClose}>
              Keep walking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { travelBtnWide };
