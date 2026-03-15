import { Preferences } from '@capacitor/preferences';
import type { StateStorage } from 'zustand/middleware';
import { createJSONStorage } from 'zustand/middleware';
import { isNativePlatform } from './platform';

const capacitorStorage: StateStorage = {
  getItem: async (name) => {
    const { value } = await Preferences.get({ key: name });
    return value ?? null;
  },
  setItem: async (name, value) => {
    await Preferences.set({ key: name, value });
  },
  removeItem: async (name) => {
    await Preferences.remove({ key: name });
  },
};

export const appStorage = createJSONStorage(() => (isNativePlatform() ? capacitorStorage : localStorage));