import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getAsset } from '../domain/assets';
import { DEFAULT_WATCHLIST, Pair, pairKey, samePair } from '../domain/pair';

type WatchlistState = {
  pairs: Pair[];
  hydrated: boolean;
  add: (pair: Pair) => void;
  remove: (pair: Pair) => void;
  move: (from: number, to: number) => void;
  has: (pair: Pair) => boolean;
  reset: () => void;
};

export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      pairs: DEFAULT_WATCHLIST,
      hydrated: false,

      add: (pair) =>
        set((state) =>
          state.pairs.some((p) => samePair(p, pair))
            ? state
            : { pairs: [...state.pairs, pair] },
        ),

      remove: (pair) =>
        set((state) => ({ pairs: state.pairs.filter((p) => !samePair(p, pair)) })),

      move: (from, to) =>
        set((state) => {
          if (from === to) return state;
          const pairs = [...state.pairs];
          if (from < 0 || from >= pairs.length || to < 0 || to >= pairs.length) return state;
          const [moved] = pairs.splice(from, 1);
          pairs.splice(to, 0, moved);
          return { pairs };
        }),

      has: (pair) => get().pairs.some((p) => samePair(p, pair)),

      reset: () => set({ pairs: DEFAULT_WATCHLIST }),
    }),
    {
      name: 'exchaing.watchlist.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ pairs: state.pairs }),
      onRehydrateStorage: () => (state) => {
        useWatchlist.setState({ hydrated: true });
        // Drop duplicates, self-pairs, and pairs whose assets left the catalog
        // between app versions — a stale entry would render as a dead row.
        if (state?.pairs) {
          const seen = new Set<string>();
          const pairs = state.pairs.filter((p) => {
            const key = pairKey(p);
            if (seen.has(key) || p.base === p.quote) return false;
            if (!getAsset(p.base) || !getAsset(p.quote)) return false;
            seen.add(key);
            return true;
          });
          if (pairs.length !== state.pairs.length) useWatchlist.setState({ pairs });
        }
      },
    },
  ),
);
