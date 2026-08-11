import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Pair, assetIdsInPairs, pairKey } from '../domain/pair';
import { crossRate, pctChange } from '../domain/rates';
import { changeLabelFor, fetchUsdPrices, refreshIntervalFor } from '../sources/registry';
import { useSettings } from '../store/settings';

export type PairQuote = {
  pair: Pair;
  key: string;
  rate: number | null;
  changePct: number | null;
  changeLabel: string;
};

/**
 * One query for the whole screen.
 *
 * Prices are fetched per asset, not per pair, so a watchlist of twenty pairs
 * built from eight assets still costs two network calls. Every pair is then
 * derived locally, which also means the converter and the detail screen read
 * from the same cache instead of refetching.
 */
export function useUsdPrices(pairs: Pair[]) {
  const autoRefresh = useSettings((s) => s.autoRefresh);
  const assetIds = useMemo(() => assetIdsInPairs(pairs).sort(), [pairs]);
  const interval = useMemo(() => refreshIntervalFor(assetIds), [assetIds]);

  return useQuery({
    queryKey: ['usd-prices', assetIds],
    queryFn: ({ signal }) => fetchUsdPrices(assetIds, signal),
    enabled: assetIds.length > 0,
    refetchInterval: autoRefresh ? interval : false,
    refetchIntervalInBackground: false,
    staleTime: Math.max(0, interval - 5_000),
    // Keep showing the last good rates while a refresh is in flight; a blank
    // screen every minute would be worse than a slightly stale number.
    placeholderData: (previous) => previous,
    retry: 1,
  });
}

export function usePairQuotes(pairs: Pair[]) {
  const query = useUsdPrices(pairs);

  const quotes = useMemo<PairQuote[]>(() => {
    const prices = query.data?.prices ?? {};
    const before = query.data?.pricesBefore ?? {};
    return pairs.map((pair) => ({
      pair,
      key: pairKey(pair),
      rate: crossRate(pair, prices),
      changePct: pctChange(crossRate(pair, before), crossRate(pair, prices)),
      changeLabel: changeLabelFor([pair.base, pair.quote]),
    }));
  }, [pairs, query.data]);

  return { quotes, query };
}

/** Single-pair convenience wrapper over the same cache. */
export function usePairQuote(pair: Pair | null) {
  const pairs = useMemo(() => (pair ? [pair] : []), [pair?.base, pair?.quote]);
  const { quotes, query } = usePairQuotes(pairs);
  return { quote: quotes[0] ?? null, query };
}
