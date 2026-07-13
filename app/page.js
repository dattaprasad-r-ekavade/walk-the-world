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
import { dailyDestination, whereAmIRound } from '@/lib/daily';
import { copyText, streetShareUrl } from '@/lib/share';
import { BrandMark } from '@/components/Brand';
import { AppIcon } from '@/components/AppIcon';
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
  const passport = useGameStore((s) => s.passport);
  const photoMode = useGameStore((s) => s.photoMode);
  const setPhotoMode = useGameStore((s) => s.setPhotoMode);
  const togglePhotoMode = useGameStore((s) => s.togglePhotoMode);
  const whereAmI = useGameStore((s) => s.whereAmI);
  const startWhereAmI = useGameStore((s) => s.startWhereAmI);
  const guessWhereAmI = useGameStore((s) => s.guessWhereAmI);
  const clearWhereAmI = useGameStore((s) => s.clearWhereAmI);

  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, stage: 'Starting…' });
  const [bigMap, setBigMap] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [shareToast, setShareToast] = useState(null);
  const [todayWalk] = useState(() => dailyDestination());
  const [showHow, setShowHow] = useState(false);

  const walking = hudStatus.mode === 'walk';
  const { place, replayPlace } = useReverseGeocode(hudStatus.lat, hudStatus.lon, walking);

  useEffect(() => {
    if (ready) return undefined;
    const fallback = window.setTimeout(() => {
      // The guided street route does not depend on the globe renderer. Keep the
      // portfolio path usable on software WebGL or restricted browsers where
      // Cesium never reports ready.
      setReady(true);
      const current = useGameStore.getState().screen;
      if (current === 'loading') setScreen('menu');
    }, 8000);
    return () => window.clearTimeout(fallback);
  }, [ready, setScreen]);

  useEffect(() => {
    if (hudStatus.lat !== undefined && hudStatus.lon !== undefined) {
      savePosition(hudStatus.lat, hudStatus.lon);
    }
  }, [hudStatus.lat, hudStatus.lon, savePosition]);

  const applySettings = (patch) => {
    changeSetting(patch);
    controllerRef.current?.applySettings(patch);
  };

  const exportWalkCard = () => {
    import('@/lib/engine/walk-card').then(({ downloadWalkCard }) => {
      const p = useGameStore.getState().passport;
      const label =
        (typeof place === 'string' && place) || place?.text || 'Walk card';
      downloadWalkCard(p, { place: label });
    });
  };

  const fly = (lat, lon) => {
    setScreen('play');
    setPanel(null);
    setPhotoMode(false);
    // warm the city cell WHILE the fly-down animation plays — by the time the
    // street engine boots, a cold Overpass fetch has had a 10-15s head start
    fetch(`/api/city/${cityCacheKey(lat, lon)}`).catch(() => {});
    controllerRef.current?.flyToStreet(lat, lon);
  };

  const home = () => {
    setPanel(null);
    setPhotoMode(false);
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

  const flashToast = (msg) => {
    setShareToast(msg);
    setTimeout(() => setShareToast(null), 2200);
  };

  const shareSpot = async () => {
    const lat = posRef.current?.lat ?? hudStatus.lat ?? lastPosition?.lat;
    const lon = posRef.current?.lon ?? hudStatus.lon ?? lastPosition?.lon;
    const url = streetShareUrl(lat, lon);
    if (!url) {
      flashToast('No position yet');
      return;
    }
    const ok = await copyText(url);
    flashToast(ok ? 'Link copied' : 'Could not copy link');
  };

  const launchWhereAmI = () => {
    const round = whereAmIRound();
    if (!round) return;
    startWhereAmI(round);
    setScreen('play');
    router.push(`/street?lat=${round.lat.toFixed(5)}&lon=${round.lon.toFixed(5)}&guess=1`);
  };

  const launchGuidedDemo = () => {
    setScreen('play');
    setPanel(null);
    fetch(`/api/city/${cityCacheKey(35.6595, 139.7005)}`).catch(() => {});
    router.push('/street?lat=35.6595&lon=139.7005&demo=1');
  };

  useGameKeyboard(
    (e) => {
      if (screen !== 'play') return;
      if (e.code === 'Escape' && photoMode) {
        setPhotoMode(false);
        return;
      }
      if (photoMode && e.code !== 'KeyH') return;
      if (e.code === 'KeyH') {
        e.preventDefault();
        togglePhotoMode();
        setPanel(null);
        return;
      }
      if (e.code === 'KeyM') togglePanel('travel');
      if (e.code === 'KeyP') togglePanel('pause');
      if (e.code === 'Tab') {
        e.preventDefault();
        setBigMap((b) => !b);
      }
      if (e.code === 'KeyN') replayPlace();
    },
    [screen, togglePanel, replayPlace, photoMode, setPhotoMode, togglePhotoMode, setPanel]
  );

  const hintText = walking
    ? hudStatus.locked
      ? 'WASD move · mouse look · Shift sprint · V view · Tab map · M travel · H photo'
      : 'Click the view to look around · WASD walk · M travel · H photo'
    : 'Double-click the ground to land & walk · drag orbit · scroll zoom · M travel';

  return (
    <main>
      <EngineErrorBoundary label="Cesium globe crashed">
        <Globe
          controllerRef={controllerRef}
          onReady={() => {
            setReady(true);
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
          <div className={`${menuCard} relative w-[min(980px,96vw)] overflow-hidden rounded-[30px] border border-white/10 bg-[#06101ad9] text-left shadow-[0_40px_130px_rgba(0,0,0,.72)] backdrop-blur-xl`}>
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-mint/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 rounded-full bg-trail/10 blur-3xl" />
            <div className="relative grid items-center gap-8 lg:grid-cols-[1.1fr_.9fr] lg:gap-12">
              <section>
                <BrandMark className={menuLogo} />
                <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-mint">
                  <span className="h-1.5 w-1.5 rounded-full bg-mint" /> A living planet from open data
                </div>
                <h1 className={menuTitle}>WALK THE<br className="hidden sm:block" /> WORLD</h1>
                <p className={menuSub}>Explore anywhere on Earth</p>
                <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">
                  Real streets rebuilt from open map data, streamed as a living 3D world, and audited by an evidence-bound AI reconstruction layer.
                </p>
                <div className="mt-6 grid max-w-xl grid-cols-3 gap-2 text-center">
                  {[
                    ['Global', 'Open data'],
                    ['Living', 'Time + weather'],
                    ['Auditable', 'AI repair'],
                  ].map(([value, label]) => (
                    <div key={value} className="rounded-2xl border border-white/8 bg-white/[.035] px-2 py-3">
                      <div className="text-xs font-bold text-white sm:text-sm">{value}</div>
                      <div className="mt-1 text-[9px] uppercase tracking-wider text-slate-500 sm:text-[10px]">{label}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[24px] border border-white/10 bg-black/20 p-3 sm:p-4">
                <div className="mb-3 flex items-center justify-between px-1">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-mint">Recommended</div>
                    <div className="mt-1 text-lg font-bold text-white">The 60-second tour</div>
                  </div>
                  <span className="rounded-full border border-trail/30 bg-trail/10 px-2.5 py-1 text-[10px] font-bold text-trail">SHIBUYA</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  <button type="button" className={menuBtnPrimary} onClick={launchGuidedDemo} disabled={!ready} data-testid="guided-demo">
                    <span className="flex items-center justify-center gap-2"><AppIcon name="compass" /> {ready ? 'Experience the guided demo' : 'Preparing the world…'}</span>
                  </button>
                  <button
                    type="button"
                    className={menuBtn}
                    onClick={() => setScreen('play')}
                    disabled={!ready}
                  >
                    Free explore the globe
                  </button>
                  {todayWalk && (
                    <button type="button" className={menuBtn} disabled={!ready} onClick={() => fly(todayWalk.lat, todayWalk.lon)} title={`${todayWalk.lat.toFixed(4)}, ${todayWalk.lon.toFixed(4)}`}>
                      Today&apos;s walk · {todayWalk.name}
                    </button>
                  )}
                  <div className="grid grid-cols-2 gap-2.5">
                    <button type="button" className={menuBtn} disabled={!ready} onClick={launchWhereAmI}>Where am I?</button>
                    <button type="button" className={menuBtn} onClick={() => togglePanel('travel')}>Fast travel</button>
                  </div>
                  <button type="button" className={menuBtn} onClick={() => setShowHow((value) => !value)} aria-expanded={showHow}>
                    {showHow ? 'Hide how it works' : 'See how it works'}
                  </button>
                </div>
                {showHow && (
                  <ol className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-400">
                    <li><span className="mr-2 text-mint">01</span>OpenStreetMap and terrain data form each real cell.</li>
                    <li><span className="mr-2 text-mint">02</span>A worker builds compact 3D geometry while nearby cells stream.</li>
                    <li><span className="mr-2 text-mint">03</span>World Repair audits gaps with confidence and provenance.</li>
                  </ol>
                )}
              </section>
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
        modeLabel={walking ? 'On foot' : 'Flying'}
        hintText={hintText}
        photoMode={photoMode}
        passport={passport}
        shareToast={shareToast}
        whereAmI={whereAmI}
        onExportWalkCard={exportWalkCard}
        onWhereAmIGuess={guessWhereAmI}
        onWhereAmIClose={clearWhereAmI}
        onWhereAmIAgain={launchWhereAmI}
        onShare={shareSpot}
        onPhotoMode={() => {
          togglePhotoMode();
          setPanel(null);
        }}
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
          { label: '🛂 Passport', onClick: () => setPanel('passport') },
          { label: '⚙ Settings', onClick: () => setPanel('settings') },
          { label: '🎮 Controls', onClick: () => setPanel('controls') },
          {
            label: '🏠 Main Menu',
            onClick: () => {
              setPanel(null);
              setPhotoMode(false);
              setScreen('menu');
              home();
            },
          },
        ]}
      />

    </main>
  );
}
