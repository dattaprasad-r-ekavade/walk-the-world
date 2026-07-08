'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LoadingScreen } from '@/components/hud/Panels';
import { GameShell } from '@/components/game-shell/GameShell';
import { EngineErrorBoundary } from '@/components/EngineErrorBoundary';
import { useEngineStatus } from '@/hooks/use-engine-status';
import { useGameKeyboard } from '@/hooks/use-game-keyboard';
import { useReverseGeocode } from '@/hooks/use-reverse-geocode';
import { useGameStore } from '@/stores/game-store';
import { trackRender } from '@/lib/perf';
import { cityCacheKey } from '@/lib/engine/cityData';
import {
  menuBtn,
  menuBtnPrimary,
  menuCard,
  menuLogo,
  menuSub,
  menuTitle,
  overlay,
  qualityBtn,
  qualityBtnActive,
  settingLabel,
} from '@/lib/ui';

const Globe = dynamic(() => import('@/components/Globe'), { ssr: false });

export default function Home() {
  trackRender();
  const router = useRouter();
  const controllerRef = useRef(null);
  const { posRef, hudStatus, publishStatus } = useEngineStatus(250);

  const screen = useGameStore((s) => s.screen);
  const panel = useGameStore((s) => s.panel);
  const settings = useGameStore((s) => s.settings);
  const setScreen = useGameStore((s) => s.setScreen);
  const setPanel = useGameStore((s) => s.setPanel);
  const togglePanel = useGameStore((s) => s.togglePanel);
  const changeSetting = useGameStore((s) => s.changeSetting);
  const savePosition = useGameStore((s) => s.savePosition);
  const lastPosition = useGameStore((s) => s.lastPosition);
  const savedPlaces = useGameStore((s) => s.savedPlaces);
  const addPlace = useGameStore((s) => s.addPlace);
  const removePlace = useGameStore((s) => s.removePlace);

  const [ready, setReady] = useState(false);
  const [hasTiles, setHasTiles] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, stage: 'Starting…' });
  const [bigMap, setBigMap] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);

  const walking = hudStatus.mode === 'walk';
  const { place, replayPlace } = useReverseGeocode(hudStatus.lat, hudStatus.lon, walking);

  useEffect(() => {
    if (hudStatus.lat !== undefined && hudStatus.lon !== undefined) {
      savePosition(hudStatus.lat, hudStatus.lon);
    }
  }, [hudStatus.lat, hudStatus.lon, savePosition]);

  const applySettings = (patch) => {
    changeSetting(patch);
    controllerRef.current?.applySettings(patch);
  };

  const fly = (lat, lon) => {
    setScreen('play');
    setPanel(null);
    // warm the city cell WHILE the fly-down animation plays — by the time the
    // street engine boots, a cold Overpass fetch has had a 10-15s head start
    fetch(`/api/city/${cityCacheKey(lat, lon)}`).catch(() => {});
    controllerRef.current?.flyToStreet(lat, lon);
  };

  const home = () => {
    setPanel(null);
    controllerRef.current?.homeView();
  };

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

  useGameKeyboard(
    (e) => {
      if (screen !== 'play') return;
      if (e.code === 'KeyM') togglePanel('travel');
      if (e.code === 'KeyP') togglePanel('pause');
      if (e.code === 'Tab') {
        e.preventDefault();
        setBigMap((b) => !b);
      }
      if (e.code === 'KeyN') replayPlace();
    },
    [screen, togglePanel, replayPlace]
  );

  const hintText = walking
    ? hudStatus.locked
      ? 'WASD move · mouse look · Shift sprint · V view · Tab map · F fly'
      : 'Click the view to look around · F fly mode · M map'
    : 'Double-click the ground to land & walk · drag orbit · scroll zoom · M map';

  return (
    <main>
      <EngineErrorBoundary label="Cesium globe crashed">
        <Globe
          controllerRef={controllerRef}
          onReady={({ hasTiles: tiles }) => {
            setReady(true);
            setHasTiles(tiles);
            const cur = useGameStore.getState().screen;
            setScreen(cur === 'loading' ? 'menu' : cur);
          }}
          onStatus={publishStatus}
          onProgress={setProgress}
          posRef={posRef}
        />
      </EngineErrorBoundary>

      {screen === 'loading' && <LoadingScreen pct={progress.pct} stage={progress.stage} />}

      {screen === 'menu' && (
        <div className={overlay}>
          <div className={`${menuCard} relative`}>
            <div className="pointer-events-none absolute -inset-20 -z-10 rounded-full bg-accent/10 blur-3xl" />
            <div className={menuLogo}>🌍</div>
            <h1 className={menuTitle}>WALK THE WORLD</h1>
            <p className={menuSub}>An open-world walk across the real Earth</p>
            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                type="button"
                className={menuBtnPrimary}
                onClick={() => setScreen('play')}
                disabled={!ready}
              >
                {ready ? '▶ Start Exploring' : 'Loading world…'}
              </button>
              <button type="button" className={menuBtn} onClick={() => togglePanel('travel')}>
                🗺 Fast Travel
              </button>
              <button type="button" className={menuBtn} onClick={() => togglePanel('controls')}>
                🎮 Controls
              </button>
            </div>
          </div>
        </div>
      )}

      <GameShell
        engine="cesium"
        screen={screen}
        status={hudStatus}
        posRef={posRef}
        panel={panel}
        setPanel={setPanel}
        bigMap={bigMap}
        setBigMap={setBigMap}
        place={place}
        settings={settings}
        onSettingChange={applySettings}
        onTravel={fly}
        savedPlaces={savedPlaces}
        onSavePlace={() => {
          const lat = hudStatus.lat ?? lastPosition?.lat;
          const lon = hudStatus.lon ?? lastPosition?.lon;
          if (lat === undefined || lon === undefined) return;
          const name = window.prompt('Name this place', place?.text ?? place ?? '');
          if (name) addPlace(name.trim(), lat, lon);
        }}
        onRemovePlace={removePlace}
        onGoHome={home}
        onToggleWalk={() =>
          walking ? controllerRef.current?.exitWalk() : controllerRef.current?.enterWalk()
        }
        onToggleView={() =>
          controllerRef.current?.setThirdPerson(hudStatus.view !== 'third')
        }
        onStreetEngine={() =>
          router.push(
            `/street?lat=${hudStatus.lat?.toFixed(5)}&lon=${hudStatus.lon?.toFixed(5)}`
          )
        }
        onGeolocation={goToMyLocation}
        geoBusy={geoBusy}
        walking={walking}
        modeLabel={walking ? '🚶 ON FOOT' : '✈ FLYING'}
        hintText={hintText}
        settingsExtra={
          <div className="mb-4">
            <label className={settingLabel}>
              <span>🚶 Walk engine</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className={settings.engine === 'street' ? qualityBtnActive : qualityBtn}
                onClick={() => applySettings({ engine: 'street' })}
              >
                Street (fast)
              </button>
              <button
                type="button"
                className={settings.engine === 'classic' ? qualityBtnActive : qualityBtn}
                onClick={() => applySettings({ engine: 'classic' })}
              >
                Classic
              </button>
            </div>
          </div>
        }
        pauseButtons={[
          { label: '▶ Resume', primary: true, onClick: () => setPanel(null) },
          { label: '🗺 Fast Travel', onClick: () => setPanel('travel') },
          { label: '⚙ Settings', onClick: () => setPanel('settings') },
          { label: '🎮 Controls', onClick: () => setPanel('controls') },
          {
            label: '🏠 Main Menu',
            onClick: () => {
              setPanel(null);
              setScreen('menu');
              home();
            },
          },
        ]}
      />

      {ready && !hasTiles && screen === 'play' && (
        <div className="absolute bottom-16 right-4 z-10 max-w-xs rounded-lg border border-amber-400/35 bg-amber-950/90 px-3.5 py-2.5 text-xs leading-relaxed text-amber-100 shadow-lg backdrop-blur-sm">
          Basic globe mode — add a free{' '}
          <code className="rounded bg-black/40 px-1 py-0.5 text-amber-200">NEXT_PUBLIC_CESIUM_ION_TOKEN</code>{' '}
          in <code className="rounded bg-black/40 px-1 py-0.5 text-amber-200">.env.local</code> for terrain and 3D
          buildings.
        </div>
      )}
    </main>
  );
}
