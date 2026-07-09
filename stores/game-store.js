'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const emptyPassport = () => ({
  totalKm: 0,
  elevClimbed: 0,
  cities: {}, // { [name]: { km, visits, lastVisit } }
  countries: {}, // { [country]: visits }
  trail: [], // recent { lat, lon } samples for minimap / walk card
});

const defaultSettings = () => ({
  hour: 12,
  weather: 0,
  quality: 'medium',
  qualityMode: 'auto', // 'auto' | 'manual' — manual when user picks a preset
  engine: 'street',
  groundSource: 'osm', // 'osm' | 'satellite'
  music: true,
});

const TRAIL_MAX = 400;
const TRAIL_MIN_M = 8; // ~meters between trail samples (approx via lat/lon)

export const useGameStore = create(
  persist(
    (set, get) => ({
      screen: 'loading',
      panel: null,
      settings: defaultSettings(),
      lastPosition: null,
      savedPlaces: [],
      passport: emptyPassport(),
      photoMode: false,
      /** @type {null | { answer: string, lat: number, lon: number, options: string[], revealed: boolean, correct: boolean|null }} */
      whereAmI: null,

      setScreen: (screen) => set({ screen }),
      setPanel: (panel) => set({ panel }),
      togglePanel: (name) =>
        set({ panel: get().panel === name ? null : name }),

      changeSetting: (patch) => {
        const next = { ...get().settings, ...patch };
        // picking a quality preset locks out auto-detect
        if (patch.quality && patch.qualityMode === undefined) next.qualityMode = 'manual';
        set({ settings: next });
      },

      savePosition: (lat, lon) => set({ lastPosition: { lat, lon } }),

      /** Append a trail point when the player has moved enough (10.5). */
      pushTrailPoint: (lat, lon) => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const passport = get().passport || emptyPassport();
        const trail = passport.trail ? [...passport.trail] : [];
        const last = trail[trail.length - 1];
        if (last) {
          const dLat = (lat - last.lat) * 111320;
          const dLon = (lon - last.lon) * 111320 * Math.cos((lat * Math.PI) / 180);
          if (Math.hypot(dLat, dLon) < TRAIL_MIN_M) return;
        }
        trail.push({ lat, lon });
        while (trail.length > TRAIL_MAX) trail.shift();
        set({ passport: { ...passport, trail } });
      },

      /** Replace trail in one shot (from a live ref flush). */
      setTrail: (points) => {
        const passport = get().passport || emptyPassport();
        const trail = Array.isArray(points) ? points.slice(-TRAIL_MAX) : [];
        set({ passport: { ...passport, trail } });
      },

      /** Record positive elevation gain (meters). */
      recordElevClimb: (meters) => {
        if (!meters || meters <= 0) return;
        const passport = get().passport || emptyPassport();
        set({
          passport: {
            ...passport,
            elevClimbed: (passport.elevClimbed || 0) + meters,
          },
        });
      },

      addPlace: (name, lat, lon) =>
        set({
          savedPlaces: [
            ...get().savedPlaces.filter((p) => p.name !== name),
            { name, lat, lon },
          ],
        }),
      removePlace: (name) =>
        set({ savedPlaces: get().savedPlaces.filter((p) => p.name !== name) }),

      setPhotoMode: (on) => set({ photoMode: !!on }),
      togglePhotoMode: () => set({ photoMode: !get().photoMode }),

      startWhereAmI: (round) =>
        set({
          whereAmI: {
            answer: round.answer,
            lat: round.lat,
            lon: round.lon,
            options: round.options,
            revealed: false,
            correct: null,
          },
          photoMode: true,
          panel: 'whereami',
        }),
      guessWhereAmI: (name) => {
        const round = get().whereAmI;
        if (!round || round.revealed) return;
        const correct = name === round.answer;
        set({
          whereAmI: { ...round, revealed: true, correct },
          photoMode: false,
        });
      },
      clearWhereAmI: () => set({ whereAmI: null, panel: null, photoMode: false }),

      /** Record meters walked in a named place (localStorage passport). */
      recordWalk: (meters, cityName, countryName) => {
        if (!meters || meters <= 0) return;
        const km = meters / 1000;
        const passport = get().passport || emptyPassport();
        const cities = { ...passport.cities };
        const countries = { ...(passport.countries || {}) };
        const key = (cityName && String(cityName).trim()) || 'Unknown';
        const prev = cities[key] || { km: 0, visits: 0, lastVisit: null };
        const isNewVisit = !prev.lastVisit || Date.now() - new Date(prev.lastVisit).getTime() > 6 * 3600e3;
        cities[key] = {
          km: prev.km + km,
          visits: prev.visits + (isNewVisit ? 1 : 0),
          lastVisit: new Date().toISOString(),
        };
        const country = countryName && String(countryName).trim();
        if (country) countries[country] = (countries[country] || 0) + (isNewVisit ? 1 : 0);
        set({
          passport: {
            ...passport,
            totalKm: (passport.totalKm || 0) + km,
            elevClimbed: passport.elevClimbed || 0,
            cities,
            countries,
            trail: passport.trail || [],
          },
        });
      },
    }),
    {
      name: 'wtw-game',
      partialize: (s) => ({
        settings: s.settings,
        lastPosition: s.lastPosition,
        savedPlaces: s.savedPlaces,
        passport: s.passport,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...persisted,
        settings: { ...defaultSettings(), ...(persisted?.settings || {}) },
        passport: { ...emptyPassport(), ...(persisted?.passport || {}) },
      }),
    }
  )
);
