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
      <div>
        <label className={settingLabel}>
          <span>🖥 Quality</span>
        </label>
        <div className="flex gap-2">
          {['low', 'medium', 'high'].map((q) => (
            <button
              key={q}
              type="button"
              className={settings.quality === q ? qualityBtnActive : qualityBtn}
              onClick={() => onChange({ quality: q })}
            >
              {q[0].toUpperCase() + q.slice(1)}
            </button>
          ))}
        </div>
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
    ['M', 'Fast travel map'],
    ['Tab', 'Expand / collapse the map'],
    ['N', 'Show current location name'],
    ['P', 'Pause menu'],
    ['Esc', 'Release mouse'],
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

export { travelBtnWide };
