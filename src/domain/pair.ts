import { Asset, getAsset } from './assets';

/** A quoted pair: how many units of `quote` buy one unit of `base`. */
export type Pair = {
  base: string;
  quote: string;
};

/** Canonical string form, e.g. "EUR/USD". Used as a key and as a route param. */
export function pairKey(pair: Pair): string {
  return `${pair.base}/${pair.quote}`;
}

export function parsePairKey(key: string): Pair | null {
  const [base, quote] = key.split('/');
  if (!base || !quote) return null;
  if (!getAsset(base) || !getAsset(quote)) return null;
  return { base, quote };
}

export function invertPair(pair: Pair): Pair {
  return { base: pair.quote, quote: pair.base };
}

export function samePair(a: Pair, b: Pair): boolean {
  return a.base === b.base && a.quote === b.quote;
}

export type ResolvedPair = Pair & {
  baseAsset: Asset;
  quoteAsset: Asset;
};

export function resolvePair(pair: Pair): ResolvedPair | null {
  const baseAsset = getAsset(pair.base);
  const quoteAsset = getAsset(pair.quote);
  if (!baseAsset || !quoteAsset) return null;
  return { ...pair, baseAsset, quoteAsset };
}

/** Every distinct asset referenced by a list of pairs. */
export function assetIdsInPairs(pairs: Pair[]): string[] {
  const ids = new Set<string>();
  for (const p of pairs) {
    ids.add(p.base);
    ids.add(p.quote);
  }
  return [...ids];
}

/** Shown on first launch. Majors first, then a taste of what else is possible. */
export const DEFAULT_WATCHLIST: Pair[] = [
  { base: 'EUR', quote: 'USD' },
  { base: 'GBP', quote: 'USD' },
  { base: 'USD', quote: 'JPY' },
  { base: 'USD', quote: 'CHF' },
  { base: 'BTC', quote: 'USD' },
  { base: 'XAU', quote: 'USD' },
];
