"use client";

// Shared HUD panels used by BOTH the Cesium page (app/page.js) and the
// Street Engine — one source of truth so the two UIs can't drift.
import { PLACES } from "@/lib/geo";

export function LoadingScreen({ logo = "🌍", title = "WALK THE WORLD", pct, stage }) {
  return (
    <div className="menu-screen">
      <div className="menu-card">
        <div className="menu-logo">{logo}</div>
        <h1 className={`menu-title${title.length > 14 ? "" : " small"}`}>{title}</h1>
        <div className="load-bar">
          <div className="load-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="load-stage">{stage}</p>
      </div>
    </div>
  );
}

export function TravelPanel({ onTravel, onClose, extraTop = null }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>🗺 Fast Travel</h2>
        <button className="close" onClick={onClose}>✕</button>
      </div>
      <div className="travel-grid">
        {extraTop}
        {PLACES.map((p) => (
          <button key={p.name} onClick={() => onTravel(p.lat, p.lon)}>
            📍 {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPanel({ settings, onChange, onClose, children }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>⚙ Settings</h2>
        <button className="close" onClick={onClose}>✕</button>
      </div>
      <div className="setting-row">
        <label>
          🕐 Time of day{" "}
          <span>
            {String(Math.floor(settings.hour)).padStart(2, "0")}:
            {settings.hour % 1 ? "30" : "00"}
          </span>
        </label>
        <input
          type="range" min="0" max="23.5" step="0.5"
          value={settings.hour}
          onChange={(e) => onChange({ hour: parseFloat(e.target.value) })}
        />
      </div>
      <div className="setting-row">
        <label>
          🌦 Weather{" "}
          <span>
            {settings.weather < 25 ? "Clear" : settings.weather < 55 ? "Hazy" : settings.weather < 85 ? "Overcast" : "Heavy fog"}
          </span>
        </label>
        <input
          type="range" min="0" max="100" step="5"
          value={settings.weather}
          onChange={(e) => onChange({ weather: parseInt(e.target.value) })}
        />
      </div>
      {children}
      <div className="setting-row">
        <label>🖥 Quality</label>
        <div className="quality-btns">
          {["low", "medium", "high"].map((q) => (
            <button
              key={q}
              className={settings.quality === q ? "active" : ""}
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

export function PauseMenu({ title = "PAUSED", buttons }) {
  return (
    <div className="menu-screen dim">
      <div className="menu-card">
        <h1 className="menu-title small">{title}</h1>
        <div className="menu-buttons">
          {buttons.map(({ label, primary, onClick }) => (
            <button
              key={label}
              className={`menu-btn${primary ? " primary" : ""}`}
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
