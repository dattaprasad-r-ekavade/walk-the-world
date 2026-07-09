'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const emptyPassport = () => ({
  totalKm: 0,
  cities: {}, // { [name]: { km, visits, lastVisit } }
});

const defaultSettings = () => ({
  hour: 12,
  weather: 0,
  quality: 'medium',
  engine: 'street',
  groundSource: 'osm', // 'osm' | 'satellite'
  music: true,
});

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

      changeSetting: (patch) =>
        set({ settings: { ...get().settings, ...patch } }),

      savePosition: (lat, lon) => set({ lastPosition: { lat, lon } }),

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
      recordWalk: (meters, cityName) => {
        if (!meters || meters <= 0) return;
        const km = meters / 1000;
        const passport = get().passport || emptyPassport();
        const cities = { ...passport.cities };
        const key = (cityName && String(cityName).trim()) || 'Unknown';
        const prev = cities[key] || { km: 0, visits: 0, lastVisit: null };
        const isNewVisit = !prev.lastVisit || Date.now() - new Date(prev.lastVisit).getTime() > 6 * 3600e3;
        cities[key] = {
          km: prev.km + km,
          visits: prev.visits + (isNewVisit ? 1 : 0),
          lastVisit: new Date().toISOString(),
        };
        set({
          passport: {
            totalKm: passport.totalKm + km,
            cities,
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
      }),
    }
  )
);
