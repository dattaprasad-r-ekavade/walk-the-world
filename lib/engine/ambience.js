// Ambient city audio, fully synthesized (no assets): filtered noise beds for
// traffic hum / wind / rain, tied to time-of-day and weather. Starts on the
// first user gesture (browser autoplay policy) and can be muted.
export function createAmbience() {
  let ctx = null;
  let master = null;
  let traffic = null, rain = null, wind = null;
  let muted = typeof localStorage !== "undefined" && localStorage.getItem("wtw_muted") === "1";
  let started = false;
  const state = { density: 0.7, raining: false, hour: 12 };

  const noiseBuffer = (c, seconds = 2) => {
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // brownish noise: integrate white noise for a deeper, road-like rumble
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

  const applyLevels = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const hf = state.hour < 5 ? 0.15 : state.hour < 8 ? 0.5 : state.hour >= 22 ? 0.3 : 1;
    traffic?.gain.setTargetAtTime(0.5 * state.density * hf, t, 0.8);
    rain?.gain.setTargetAtTime(state.raining ? 0.55 : 0, t, 0.8);
    wind?.gain.setTargetAtTime(0.12, t, 0.8);
    master?.gain.setTargetAtTime(muted ? 0 : 0.16, t, 0.3);
  };

  const start = () => {
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
      applyLevels();
    } catch {
      /* audio unavailable — stay silent */
    }
  };

  return {
    start, // call from a user gesture (click / keydown)
    set({ density, raining, hour }) {
      if (density !== undefined) state.density = density;
      if (raining !== undefined) state.raining = raining;
      if (hour !== undefined) state.hour = hour;
      applyLevels();
    },
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem("wtw_muted", muted ? "1" : "0"); } catch { /* ok */ }
      applyLevels();
      return muted;
    },
    get muted() { return muted; },
    dispose() {
      try { ctx?.close(); } catch { /* ok */ }
    },
  };
}
