import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

type SettingsState = {
  themePreference: ThemePreference;
  /** Auto-refresh while the Rates screen is open. */
  autoRefresh: boolean;
  /** Haptic tick when a rate updates on screen. */
  haptics: boolean;
  /** Colour direction: true = green up (Western), false = red up (East Asian). */
  greenUp: boolean;
  setThemePreference: (value: ThemePreference) => void;
  setAutoRefresh: (value: boolean) => void;
  setHaptics: (value: boolean) => void;
  setGreenUp: (value: boolean) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      themePreference: 'system',
      autoRefresh: true,
      haptics: true,
      greenUp: true,
      setThemePreference: (themePreference) => set({ themePreference }),
      setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
      setHaptics: (haptics) => set({ haptics }),
      setGreenUp: (greenUp) => set({ greenUp }),
    }),
    {
      name: 'exchaing.settings.v1',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
