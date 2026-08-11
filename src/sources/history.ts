import { NUMERAIRE, requireAsset } from '../domain/assets';
import { Pair } from '../domain/pair';
import { SeriesPoint, constantSeries, divideSeries } from '../domain/rates';
import { sourceForAsset } from './registry';

export type RangeKey = '1D' | '1W' | '1M' | '3M' | '1Y';

export const RANGES: { key: RangeKey; days: number; label: string }[] = [
  { key: '1D', days: 1, label: '1D' },
  { key: '1W', days: 7, label: '1W' },
  { key: '1M', days: 30, label: '1M' },
  { key: '3M', days: 90, label: '3M' },
  { key: '1Y', days: 365, label: '1Y' },
];

export function daysForRange(range: RangeKey): number {
  return RANGES.find((r) => r.key === range)?.days ?? 30;
}

async function usdHistory(assetId: string, days: number, signal?: AbortSignal): Promise<SeriesPoint[]> {
  if (assetId === NUMERAIRE) return [];
  const asset = requireAsset(assetId);
  const source = sourceForAsset(assetId);
  if (!source?.getUsdHistory) return [];
  return source.getUsdHistory(asset, days, signal);
}

function invertValues(series: SeriesPoint[]): SeriesPoint[] {
  return series.filter((p) => p.v > 0).map((p) => ({ t: p.t, v: 1 / p.v }));
}

/**
 * Historical series for a pair, in quote units per base unit.
 *
 * Legs can be sampled very differently — ECB publishes fiat once a day while
 * CoinGecko samples crypto every few minutes — so we spine the result on
 * whichever leg has more points and let `divideSeries` match the other one by
 * nearest timestamp. Charting BTC/EUR on 30 daily points instead of 700
 * intraday ones would throw away most of the shape.
 */
export async function fetchPairHistory(
  pair: Pair,
  days: number,
  signal?: AbortSignal,
): Promise<SeriesPoint[]> {
  const [baseSeries, quoteSeries] = await Promise.all([
    usdHistory(pair.base, days, signal),
    usdHistory(pair.quote, days, signal),
  ]);

  if (pair.quote === NUMERAIRE) return baseSeries;
  if (pair.base === NUMERAIRE) return invertValues(quoteSeries);

  if (baseSeries.length === 0 || quoteSeries.length === 0) return [];

  if (quoteSeries.length > baseSeries.length) {
    // Spine on the quote leg, then flip: (quote/base)⁻¹ = base/quote.
    return invertValues(divideSeries(quoteSeries, baseSeries));
  }
  return divideSeries(baseSeries, quoteSeries);
}

export { constantSeries };
