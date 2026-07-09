// Ambient city audio: synthesized noise beds (traffic/wind/rain) plus a soft
// musical pad that crossfades day→night. Optional CC0 OGG loops at
// /audio/day.ogg and /audio/night.ogg replace the pad when present.
export function createAmbience() {
  let ctx = null;
  let master = null;
  let traffic = null, rain = null, wind = null;
  let musicDay = null, musicNight = null;
  let dayEl = null, nightEl = null;
  let padNodes = [];
  let muted = typeof localStorage !== "undefined" && localStorage.getItem("wtw_muted") === "1";
  let musicOn = true;
  let started = false;
  const state = { density: 0.7, raining: false, hour: 12 };

  const noiseBuffer = (c, seconds = 2) => {
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  };

  const bed = (c, { type, freq, gain }) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(filt).connect(g).connect(master);
    src.start();
    return g;
  };

  /** Soft detuned sine pad — calm exploration bed without external files. */
  const makePad = (c, freqs) => {
    const g = c.createGain();
    g.gain.value = 0;
    g.connect(master);
    for (const f of freqs) {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const og = c.createGain();
      og.gain.value = 0.12 / freqs.length;
      osc.connect(og).connect(g);
      osc.start();
      padNodes.push(osc);
    }
    return g;
  };

  const tryLoadLoop = (url) =>
    new Promise((resolve) => {
      const a = new Audio();
      a.crossOrigin = "anonymous";
      a.loop = true;
      a.preload = "auto";
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok ? a : null);
      };
      a.addEventListener("canplaythrough", () => done(true), { once: true });
      a.addEventListener("error", () => done(false), { once: true });
      a.src = url;
      a.load();
      setTimeout(() => done(false), 2500);
    });

  const applyLevels = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const hf = state.hour < 5 ? 0.15 : state.hour < 8 ? 0.5 : state.hour >= 22 ? 0.3 : 1;
    traffic?.gain.setTargetAtTime(0.5 * state.density * hf, t, 0.8);
    rain?.gain.setTargetAtTime(state.raining ? 0.55 : 0, t, 0.8);
    wind?.gain.setTargetAtTime(0.12, t, 0.8);
    master?.gain.setTargetAtTime(muted ? 0 : 0.16, t, 0.3);

    const nightAmt =
      state.hour < 6 || state.hour >= 20
        ? 1
        : state.hour < 7 || state.hour >= 18
          ? 0.55
          : 0;
    const dayAmt = 1 - nightAmt;
    const duck = state.raining ? 0.45 : 1;
    const musicLevel = musicOn && !muted ? 0.55 * duck : 0;
    musicDay?.gain.setTargetAtTime(musicLevel * dayAmt, t, 1.2);
    musicNight?.gain.setTargetAtTime(musicLevel * nightAmt * 0.9, t, 1.2);
  };

  const start = async () => {
    if (started || typeof window === "undefined") return;
    started = true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      traffic = bed(ctx, { type: "lowpass", freq: 320, gain: 0 });
      wind = bed(ctx, { type: "bandpass", freq: 900, gain: 0 });
      rain = bed(ctx, { type: "highpass", freq: 2600, gain: 0 });

      const [dayFile, nightFile] = await Promise.all([
        tryLoadLoop("/audio/day.ogg"),
        tryLoadLoop("/audio/night.ogg"),
      ]);

      if (dayFile && nightFile) {
        musicDay = ctx.createGain();
        musicNight = ctx.createGain();
        musicDay.gain.value = 0;
        musicNight.gain.value = 0;
        musicDay.connect(master);
        musicNight.connect(master);
        dayEl = dayFile;
        nightEl = nightFile;
        ctx.createMediaElementSource(dayEl).connect(musicDay);
        ctx.createMediaElementSource(nightEl).connect(musicNight);
        dayEl.play().catch(() => {});
        nightEl.play().catch(() => {});
      } else {
        musicDay = makePad(ctx, [130.81, 164.81, 196.0, 261.63]);
        musicNight = makePad(ctx, [110.0, 130.81, 164.81, 220.0]);
      }

      applyLevels();
    } catch {
      /* audio unavailable — stay silent */
    }
  };

  return {
    start,
    set({ density, raining, hour, music }) {
      if (density !== undefined) state.density = density;
      if (raining !== undefined) state.raining = raining;
      if (hour !== undefined) state.hour = hour;
      if (music !== undefined) musicOn = !!music;
      applyLevels();
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem("wtw_muted", muted ? "1" : "0");
      } catch {
        /* ok */
      }
      applyLevels();
      return muted;
    },
    get muted() {
      return muted;
    },
    dispose() {
      try {
        for (const o of padNodes) o.stop();
        dayEl?.pause();
        nightEl?.pause();
        ctx?.close();
      } catch {
        /* ok */
      }
      padNodes = [];
    },
  };
}
