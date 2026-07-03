"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { PLACES } from "@/lib/geo";
import Minimap from "@/components/Minimap";
import { LoadingScreen, TravelPanel, SettingsPanel, PauseMenu } from "@/components/hud/Panels";

const Globe = dynamic(() => import("@/components/Globe"), { ssr: false });

function formatElevation(m) {
  if (m === null || m === undefined) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`;
}

function formatCoord(v, pos, neg) {
  if (v === undefined || v === null || !isFinite(v)) return "";
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
}

export default function Home() {
  const controllerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [hasTiles, setHasTiles] = useState(false);
  const [status, setStatus] = useState({ mode: "fly", view: "first", elevation: null, locked: false });
  const [screen, setScreen] = useState("loading"); // loading | menu | play
  const [panel, setPanel] = useState(null); // null | travel | controls | pause
  const [progress, setProgress] = useState({ pct: 0, stage: "Starting…" });
  const [place, setPlace] = useState(null); // GTA-style location title
  const [bigMap, setBigMap] = useState(false); // Tab-expanded map
  const lastGeo = useRef({ lat: null, lon: null, t: 0 });
  const lastPlace = useRef(null);
  const posRef = useRef(null); // live position, written by the engine each frame
  const [geoBusy, setGeoBusy] = useState(false);
  const [settings, setSettings] = useState({ hour: 12, weather: 0, quality: "medium", engine: "street" });

  const changeSetting = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    controllerRef.current?.applySettings(patch);
  };

  // Browser geolocation → fly to the user's real position.
  const goToMyLocation = () => {
    if (!navigator.geolocation) return;
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false);
        fly(pos.coords.latitude, pos.coords.longitude);
      },
      () => setGeoBusy(false),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  const walking = status.mode === "walk";

  // Reverse-geocode the walker position (free, keyless) and show a
  // GTA-style location title when the area changes.
  useEffect(() => {
    if (!walking || status.lat === undefined) return;
    const { lat, lon } = status;
    const prev = lastGeo.current;
    const moved =
      prev.lat === null ||
      Math.hypot(lat - prev.lat, lon - prev.lon) > 0.003 || // ~300 m
      Date.now() - prev.t > 60000;
    if (!moved) return;
    lastGeo.current = { lat, lon, t: Date.now() };
    fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    )
      .then((r) => r.json())
      .then((d) => {
        const line = [d.locality || d.city, d.principalSubdivision, d.countryName]
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 2)
          .join(", ");
        if (line) {
          lastPlace.current = line;
          setPlace({ text: line, key: Date.now() });
        }
      })
      .catch(() => {});
  }, [walking, status.lat, status.lon]);

  const fly = (lat, lon) => {
    setScreen("play");
    setPanel(null);
    controllerRef.current?.flyToStreet(lat, lon);
  };
  const home = () => {
    setPanel(null);
    controllerRef.current?.homeView();
  };

  // M toggles the map/fast-travel panel, P the pause menu (in game).
  useEffect(() => {
    const onKey = (e) => {
      if (screen !== "play") return;
      if (e.code === "KeyM") setPanel((p) => (p === "travel" ? null : "travel"));
      if (e.code === "KeyP") setPanel((p) => (p === "pause" ? null : "pause"));
      if (e.code === "Tab") {
        e.preventDefault(); // keep focus in-game
        setBigMap((b) => !b);
      }
      if (e.code === "KeyN" && lastPlace.current) {
        setPlace({ text: lastPlace.current, key: Date.now() });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  return (
    <main>
      <Globe
        controllerRef={controllerRef}
        onReady={({ hasTiles }) => {
          setReady(true);
          setHasTiles(hasTiles);
          setScreen((sc) => (sc === "loading" ? "menu" : sc));
        }}
        onStatus={setStatus}
        onProgress={(pr) => {
          setProgress(pr);
        }}
        posRef={posRef}
      />

      {/* ============ LOADING SCREEN ============ */}
      {screen === "loading" && <LoadingScreen pct={progress.pct} stage={progress.stage} />}

      {/* ============ TITLE / MENU SCREEN ============ */}
      {screen === "menu" && (
        <div className="menu-screen">
          <div className="menu-card">
            <div className="menu-logo">🌍</div>
            <h1 className="menu-title">WALK THE WORLD</h1>
            <p className="menu-sub">An open-world walk across the real Earth</p>
            <div className="menu-buttons">
              <button
                className="menu-btn primary"
                onClick={() => setScreen("play")}
                disabled={!ready}
              >
                {ready ? "▶ Start Exploring" : "Loading world…"}
              </button>
              <button
                className="menu-btn"
                onClick={() => setPanel(panel === "travel" ? null : "travel")}
              >
                🗺 Fast Travel
              </button>
              <button
                className="menu-btn"
                onClick={() => setPanel(panel === "controls" ? null : "controls")}
              >
                🎮 Controls
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ IN-GAME HUD ============ */}
      {screen === "play" && (
        <>
          {/* minimap + coords (top-right) */}
          <div className="map-corner">
            <Minimap
              lat={status.lat}
              lon={status.lon}
              heading={status.heading}
              height={status.height}
              posRef={posRef}
            />
            <div className="coords">
              {formatCoord(status.lat, "N", "S")} · {formatCoord(status.lon, "E", "W")}
            </div>
          </div>

          {/* icon toolbar (top-left) */}
          <div className="toolbar">
            <button title="Menu (P)" onClick={() => setPanel(panel === "pause" ? null : "pause")}>☰</button>
            <button title="Fast travel (M)" onClick={() => setPanel(panel === "travel" ? null : "travel")}>🗺</button>
            <button title="Globe view" onClick={home}>🌐</button>
            <button title="Settings" onClick={() => setPanel(panel === "settings" ? null : "settings")}>⚙</button>
            <button
              title="First/third person (V)"
              onClick={() =>
                controllerRef.current?.setThirdPerson(status.view !== "third")
              }
            >
              {status.view === "third" ? "👁" : "👤"}
            </button>
            {walking && (
              <button
                title="Street Engine (Three.js beta)"
                onClick={() =>
                  (window.location.href = `/street?lat=${status.lat?.toFixed(5)}&lon=${status.lon?.toFixed(5)}`)
                }
              >
                🎮
              </button>
            )}
            <button
              title="Toggle walk/fly (F)"
              onClick={() =>
                walking
                  ? controllerRef.current?.exitWalk()
                  : controllerRef.current?.enterWalk()
              }
            >
              {walking ? "✈" : "🚶"}
            </button>
          </div>

          {/* status chips (bottom-left) */}
          <div className="chips">
            <span className="chip mode">{walking ? "🚶 ON FOOT" : "✈ FLYING"}</span>
            <span className="chip">⛰ {formatElevation(status.elevation ?? (status.height ? Math.round(status.height) : null))}</span>
            {status.fps > 0 && (
              <span className={`chip fps ${status.fps < 40 ? "low" : ""}`}>
                {status.fps} FPS
              </span>
            )}
          </div>

          {/* contextual hint (bottom-center) */}
          <div className="hintbar">
            {walking
              ? status.locked
                ? "WASD move · mouse look · Shift sprint · V view · Tab map · F fly"
                : "Click the view to look around · F fly mode · M map"
              : "Double-click the ground to land & walk · drag orbit · scroll zoom · M map"}
          </div>

          {/* Tab: expanded map overlay */}
          {bigMap && (
            <div className="bigmap" onClick={() => setBigMap(false)}>
              <Minimap
                lat={status.lat}
                lon={status.lon}
                heading={status.heading}
                height={status.height}
                posRef={posRef}
                size={Math.min(560, typeof window !== "undefined" ? window.innerHeight - 160 : 560)}
                zoomBias={-1}
              />
              <div className="coords">
                {formatCoord(status.lat, "N", "S")} · {formatCoord(status.lon, "E", "W")} · Tab to close
              </div>
            </div>
          )}

          {/* crosshair in walk mode */}
          {walking && status.locked && <div className="crosshair" />}

          {/* GTA-style location title */}
          {walking && place && (
            <div className="location-toast" key={place.key}>
              {place.text}
            </div>
          )}
        </>
      )}

      {/* ============ PANELS ============ */}
      {panel === "travel" && (
        <TravelPanel
          onClose={() => setPanel(null)}
          onTravel={fly}
          extraTop={
            <button className="mylocation" onClick={goToMyLocation} disabled={geoBusy}>
              {geoBusy ? "⏳ Locating…" : "📍 My Location"}
            </button>
          }
        />
      )}

      {panel === "settings" && (
        <SettingsPanel settings={settings} onChange={changeSetting} onClose={() => setPanel(null)}>
          <div className="setting-row">
            <label>🚶 Walk engine</label>
            <div className="quality-btns">
              <button
                className={settings.engine === "street" ? "active" : ""}
                onClick={() => changeSetting({ engine: "street" })}
              >
                Street (fast)
              </button>
              <button
                className={settings.engine === "classic" ? "active" : ""}
                onClick={() => changeSetting({ engine: "classic" })}
              >
                Classic
              </button>
            </div>
          </div>
        </SettingsPanel>
      )}

      {panel === "controls" && (
        <div className="panel">
          <div className="panel-head">
            <h2>🎮 Controls</h2>
            <button className="close" onClick={() => setPanel(null)}>✕</button>
          </div>
          <table className="keys">
            <tbody>
              <tr><td><kbd>Double-click</kbd></td><td>Land anywhere & start walking</td></tr>
              <tr><td><kbd>W A S D</kbd></td><td>Walk / fly</td></tr>
              <tr><td><kbd>Mouse</kbd></td><td>Look around (walk mode)</td></tr>
              <tr><td><kbd>Shift</kbd></td><td>Sprint</td></tr>
              <tr><td><kbd>V</kbd></td><td>First / third person</td></tr>
              <tr><td><kbd>F</kbd></td><td>Toggle walk / fly</td></tr>
              <tr><td><kbd>M</kbd></td><td>Fast travel map</td></tr>
              <tr><td><kbd>Tab</kbd></td><td>Expand / collapse the map</td></tr>
              <tr><td><kbd>N</kbd></td><td>Show current location name</td></tr>
              <tr><td><kbd>P</kbd></td><td>Pause menu</td></tr>
              <tr><td><kbd>Esc</kbd></td><td>Release mouse</td></tr>
            </tbody>
          </table>
        </div>
      )}

      {panel === "pause" && screen === "play" && (
        <PauseMenu
          buttons={[
            { label: "▶ Resume", primary: true, onClick: () => setPanel(null) },
            { label: "🗺 Fast Travel", onClick: () => setPanel("travel") },
            { label: "⚙ Settings", onClick: () => setPanel("settings") },
            { label: "🎮 Controls", onClick: () => setPanel("controls") },
            { label: "🏠 Main Menu", onClick: () => { setPanel(null); setScreen("menu"); home(); } },
          ]}
        />
      )}

      {ready && !hasTiles && screen === "play" && (
        <div className="token-warn">
          Basic globe mode — add a free <code>NEXT_PUBLIC_CESIUM_ION_TOKEN</code>{" "}
          in <code>.env.local</code> for terrain and 3D buildings.
        </div>
      )}
    </main>
  );
}
