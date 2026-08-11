import { useQuery } from '@tanstack/react-query';
import { Pair, pairKey } from '../domain/pair';
import { RangeKey, daysForRange, fetchPairHistory } from '../sources/history';

export function usePairHistory(pair: Pair | null, range: RangeKey) {
  const days = daysForRange(range);

  return useQuery({
    queryKey: ['pair-history', pair ? pairKey(pair) : null, range],
    queryFn: ({ signal }) => fetchPairHistory(pair as Pair, days, signal),
    enabled: pair != null,
    // History is expensive and barely moves; an hour of cache is generous.
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });
}
