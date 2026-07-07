'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useGameStore = create(
  persist(
    (set, get) => ({
      screen: 'loading',
      panel: null,
      settings: { hour: 12, weather: 0, quality: 'medium', engine: 'street' },
      lastPosition: null,
      savedPlaces: [],

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
    }),
    {
      name: 'wtw-game',
      partialize: (s) => ({
        settings: s.settings,
        lastPosition: s.lastPosition,
        savedPlaces: s.savedPlaces,
      }),
    }
  )
);
