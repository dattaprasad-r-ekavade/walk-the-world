"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingScreen } from "@/components/hud/Panels";
import { GameShell } from "@/components/game-shell/GameShell";
import { EditorPanel } from "@/components/street/EditorPanel";
import { DebugPanel } from "@/components/street/DebugPanel";
import { StreamingToast, StreetToolButtons } from "@/components/street/StreetToolButtons";
import { createStreetRuntime } from "@/lib/engine/street/runtime";
import { STREET } from "@/lib/engine/street/constants";
import { createTrailBuffer } from "@/lib/engine/trail-buffer";
import { readBenchConfig, requestBenchMode } from "@/lib/bench";
import { whereAmIRound } from "@/lib/daily";
import { streetUrl } from "@/lib/geo";
import { copyText, streetShareUrl } from "@/lib/share";
import { menuBtnPrimary } from "@/lib/ui";
import { trackRender } from "@/lib/perf";
import { useGameStore } from "@/stores/game-store";
import { useGameKeyboard } from "@/hooks/use-game-keyboard";

// ============================================================
// Street Engine: the React shell around the street-level world.
//
// The world itself (renderer, terrain, city streaming, population, input,
// frame loop) lives in lib/engine/street/runtime.js and knows nothing about
// React. This component owns the HUD state, mounts the runtime for each
// spawn point, and forwards UI actions to the runtime's `api`.
// ============================================================

/** The engine reads persisted state through this adapter, never through hooks. */
const engineStore = {
  getSettings: () => useGameStore.getState().settings,
  changeSetting: (patch) => useGameStore.getState().changeSetting(patch),
  recordWalk: (meters, city, country) => useGameStore.getState().recordWalk(meters, city, country),
  recordElevClimb: (meters) => useGameStore.getState().recordElevClimb(meters),
  setTrail: (trail) => useGameStore.getState().setTrail(trail),
  isWhereAmIActive: () => !!useGameStore.getState().whereAmI,
};

function hintFor({ photoMode, uiMode, hudLocked }) {
  if (photoMode) return "PHOTO · WASD fly · click to look · 📸 save · Esc/H exit";
  if (uiMode === "editor") return "EDITOR · scroll zoom · MMB orbit · RMB look · WASD fly · 1-5 tools";
  if (uiMode === "debug") return "TAG INSPECTOR · WASD fly · RMB look · click a building/road/prop";
  if (hudLocked) return "WASD move · mouse look · Shift sprint · C enter/exit car · WASD drive · V view · M travel · H photo";
  return "Click to capture mouse · WASD walk · C enter car · M travel · H photo";
}

export default function StreetEngine({ lat0, lon0, resumedPosition = false, demoPreset = null, bench = false }) {
  trackRender();
  const router = useRouter();
  const panel = useGameStore((s) => s.panel);
  const setPanel = useGameStore((s) => s.setPanel);
  const togglePanel = useGameStore((s) => s.togglePanel);
  const settings = useGameStore((s) => s.settings);
  const changeSettingStore = useGameStore((s) => s.changeSetting);
  const savedPlaces = useGameStore((s) => s.savedPlaces);
  const addPlace = useGameStore((s) => s.addPlace);
  const removePlace = useGameStore((s) => s.removePlace);
  const passport = useGameStore((s) => s.passport);
  const photoMode = useGameStore((s) => s.photoMode);
  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const togglePhotoMode = useGameStore((s) => s.togglePhotoMode);
  const whereAmI = useGameStore((s) => s.whereAmI);
  const startWhereAmI = useGameStore((s) => s.startWhereAmI);
  const guessWhereAmI = useGameStore((s) => s.guessWhereAmI);
  const clearWhereAmI = useGameStore((s) => s.clearWhereAmI);

  const mountRef = useRef(null);
  const hudDomRef = useRef(null);
  const engineRef = useRef({});
  const posRef = useRef(null);
  const placeRef = useRef(null);
  const [trailBuffer] = useState(() => ({ current: createTrailBuffer(useGameStore.getState().passport?.trail) }));

  const [bootError, setBootError] = useState(null);
  const [stage, setStage] = useState("Preparing engine…");
  const [readyPct, setReadyPct] = useState(5);
  const [hudLocked, setHudLocked] = useState(false);
  // The place label belongs to one spawn point; a new spawn starts unnamed.
  const [placeFor, setPlaceFor] = useState({ key: null, text: null });
  const spawnKey = `${lat0},${lon0}`;
  const place = placeFor.key === spawnKey ? placeFor.text : null;
  const [bigMap, setBigMap] = useState(false);
  const [liveWx, setLiveWx] = useState(null);
  const [liveTemp, setLiveTemp] = useState(null);
  const [cityStreaming, setCityStreaming] = useState(false);
  const [mutedUi, setMutedUi] = useState(false);
  const [liveHud, setLiveHud] = useState({ fps: 0, elev: null });
  const [uiMode, setUiMode] = useState(null); // 'editor' | 'debug' | null
  const [debugSel, setDebugSel] = useState(null);
  const [assetList, setAssetList] = useState([]);
  const [editorMsg, setEditorMsg] = useState(null);
  const [shareToast, setShareToast] = useState(null);
  const [worldSummary, setWorldSummary] = useState(null);

  useEffect(() => {
    placeRef.current = place;
  }, [place]);

  useEffect(() => {
    engineRef.current.setPhotoFly?.(photoMode);
  }, [photoMode]);

  // One runtime per spawn point (and ground imagery source).
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    requestBenchMode(bench);
    const { api, dispose } = createStreetRuntime({
      mount,
      lat0,
      lon0,
      resumedPosition,
      demoPreset,
      groundSource: settings.groundSource === "satellite" ? "satellite" : "osm",
      bench: readBenchConfig(),
      store: engineStore,
      posRef,
      trailRef: trailBuffer,
      getPlace: () => placeRef.current,
      ui: {
        setStage,
        setReadyPct,
        setCityStreaming,
        setWorldSummary,
        setLiveHud,
        setHudLocked,
        setPlace: (text) => setPlaceFor({ key: `${lat0},${lon0}`, text }),
        setLiveTemp,
        setBootError,
        setUiMode,
        setDebugSel,
        setEditorMsg,
        setMutedUi,
      },
    });
    engineRef.current = api;
    return () => {
      dispose();
      if (engineRef.current === api) engineRef.current = {};
    };
    // The runtime reads everything else live; only a new spawn point or
    // ground source needs a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat0, lon0, settings.groundSource]);

  // Reuse the boot-time asset list request when the editor opens.
  useEffect(() => {
    if (uiMode !== "editor") return;
    const request = engineRef.current.assetListPromise ||
      fetch("/api/assets").then((r) => (r.ok ? r.json() : [])).catch(() => []);
    let cancelled = false;
    request
      .then((d) => { if (!cancelled) setAssetList(Array.isArray(d) ? d : d.assets || []); })
      .catch(() => { if (!cancelled) setAssetList([]); });
    return () => { cancelled = true; };
  }, [uiMode]);

  const useRealWeather = async () => {
    setLiveWx("loading");
    const r = await engineRef.current.applyRealWeather?.();
    if (r) {
      changeSettingStore({ hour: r.hour, weather: r.weather });
      setLiveTemp(r.temp);
      setLiveWx(`${r.temp}°C · ${r.rain > 0.05 ? "raining" : "dry"} — synced`);
    } else setLiveWx("unavailable");
  };

  const changeSetting = (patch) => {
    changeSettingStore(patch);
    const engine = engineRef.current;
    if (patch.hour !== undefined) engine.setTime?.(patch.hour);
    if (patch.weather !== undefined) {
      engine.setWeather?.(patch.weather);
      engine.setPrecip?.(patch.weather >= STREET.PRECIP_WEATHER_THRESHOLD ? "rain" : null);
    }
    if (patch.quality) engine.setQuality?.(patch.quality);
    if (patch.music !== undefined) engine.setMusic?.(patch.music);
    // groundSource: the runtime effect re-runs (full terrain rebuild).
  };

  const flashToast = (msg) => {
    setShareToast(msg);
    setTimeout(() => setShareToast(null), 2200);
  };

  const shareSpot = async () => {
    const cur = posRef.current || { lat: lat0, lon: lon0 };
    const url = streetShareUrl(cur.lat, cur.lon);
    if (!url) {
      flashToast("No position yet");
      return;
    }
    flashToast((await copyText(url)) ? "Link copied" : "Could not copy link");
  };

  const capturePhoto = () => {
    const ok = engineRef.current.captureScreenshot?.(placeRef.current);
    flashToast(ok ? "Screenshot saved" : "Screenshot failed");
  };

  const exportWalkCard = () => {
    import("@/lib/engine/walk-card").then(({ downloadWalkCard }) => {
      const p = useGameStore.getState().passport;
      const live = trailBuffer.current?.snapshot();
      const label = (typeof placeRef.current === "string" && placeRef.current) || placeRef.current?.text || "Walk card";
      downloadWalkCard({ ...p, trail: live?.length ? live : p.trail }, { place: label });
    });
  };

  useGameKeyboard(
    (e) => {
      // Where-am-I: keep the HUD hidden until the guess; Esc closes the round.
      if (whereAmI && !whereAmI.revealed) {
        if (e.code === "Escape") {
          clearWhereAmI();
          return;
        }
        if (e.code === "KeyH" || e.code === "KeyP" || e.code === "KeyM") return;
      }
      if (e.code === "Escape" && photoMode) {
        setPhotoMode(false);
        return;
      }
      if (photoMode && e.code !== "KeyH") return;
      if (e.code === "KeyH") {
        e.preventDefault();
        togglePhotoMode();
        setPanel(null);
        return;
      }
      if (e.code === "KeyM") togglePanel("travel");
      if (e.code === "KeyP") togglePanel("pause");
      if (e.code === "Tab") {
        e.preventDefault();
        setBigMap((b) => !b);
      }
    },
    [togglePanel, photoMode, setPhotoMode, togglePhotoMode, setPanel, whereAmI, clearWhereAmI]
  );

  if (bootError) throw bootError;

  const ready = readyPct >= 100;
  const streetStatus = {
    mode: "walk",
    lat: lat0,
    lon: lon0,
    heading: 0,
    height: 200,
    fps: liveHud.fps,
    locked: hudLocked,
    elevation: liveHud.elev,
  };

  return (
    <main>
      <div ref={mountRef} className="cesium-container" style={{ visibility: ready ? "visible" : "hidden" }} />
      {!ready && <LoadingScreen title="STREET ENGINE" pct={readyPct} stage={stage} />}

      {ready && (
        <GameShell
          engine="street"
          screen="play"
          status={streetStatus}
          posRef={posRef}
          trailRef={trailBuffer}
          panel={panel}
          setPanel={setPanel}
          bigMap={bigMap}
          setBigMap={setBigMap}
          place={whereAmI && !whereAmI.revealed ? null : place}
          settings={settings}
          onSettingChange={changeSetting}
          onTravel={(la, lo, demo) => {
            setPanel(null);
            router.push(streetUrl(la, lo, { demo: !!demo }));
          }}
          savedPlaces={savedPlaces}
          onSavePlace={() => {
            const cur = posRef.current || { lat: lat0, lon: lon0 };
            const name = window.prompt("Name this place", place ?? "");
            if (name) addPlace(name.trim(), cur.lat, cur.lon);
          }}
          onRemovePlace={removePlace}
          onGoHome={() => router.push("/")}
          walking
          modeLabel="Street"
          liveTemp={liveTemp}
          worldSummary={worldSummary}
          hintText={hintFor({ photoMode, uiMode, hudLocked })}
          hudRef={hudDomRef}
          coordsFallback={{ lat: lat0, lon: lon0 }}
          photoMode={photoMode}
          passport={passport}
          shareToast={shareToast}
          whereAmI={whereAmI}
          onExportWalkCard={exportWalkCard}
          onWhereAmIGuess={guessWhereAmI}
          onWhereAmIClose={clearWhereAmI}
          onWhereAmIAgain={() => {
            const round = whereAmIRound();
            if (!round) return;
            startWhereAmI(round);
            router.push(`/street?lat=${round.lat.toFixed(5)}&lon=${round.lon.toFixed(5)}&guess=1`);
          }}
          onShare={shareSpot}
          onPhotoMode={() => {
            if (whereAmI && !whereAmI.revealed) return;
            togglePhotoMode();
            setPanel(null);
          }}
          onPhotoCapture={capturePhoto}
          settingsExtra={
            <div className="mb-4">
              <button type="button" className={`${menuBtnPrimary} w-full`} onClick={useRealWeather}>
                {liveWx === "loading" ? "⏳ Fetching real conditions…" : "🌍 Use real weather & time"}
              </button>
              {typeof liveWx === "string" && liveWx !== "loading" && (
                <p className="mt-2 text-xs text-slate-500">{liveWx}</p>
              )}
            </div>
          }
          pauseButtons={[
            { label: "▶ Resume", primary: true, onClick: () => setPanel(null) },
            { label: "🗺 Fast Travel", onClick: () => setPanel("travel") },
            { label: "🛂 Passport", onClick: () => setPanel("passport") },
            { label: "⚙ Settings", onClick: () => setPanel("settings") },
            { label: "🌐 Globe View", onClick: () => router.push("/") },
          ]}
        />
      )}

      {ready && cityStreaming && !photoMode && <StreamingToast text={stage} />}
      {ready && !photoMode && (
        <StreetToolButtons engine={engineRef} developerMode={settings.developerMode} uiMode={uiMode} muted={mutedUi} />
      )}
      {ready && uiMode === "editor" && !photoMode && (
        <EditorPanel engine={engineRef} assets={assetList} message={editorMsg} />
      )}
      {ready && uiMode === "debug" && !photoMode && (
        <DebugPanel engine={engineRef} selection={debugSel} onSelectionChange={setDebugSel} />
      )}
    </main>
  );
}
