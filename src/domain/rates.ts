/**
 * Pure rate math. No I/O, no React — everything here is unit tested.
 *
 * Sources return prices in a single numeraire (USD). Any pair is then a
 * division, which is what makes fiat, crypto and metals interchangeable:
 * XAU/EUR is the same computation as EUR/USD.
 */

import { NUMERAIRE } from './assets';
import { Pair } from './pair';

/** USD price per unit of an asset, keyed by asset id. */
export type UsdPrices = Record<string, number>;

export type SeriesPoint = {
  /** Epoch milliseconds. */
  t: number;
  v: number;
};

function isUsable(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Cross rate for `pair` from USD prices. Returns null when either leg is
 * missing or unusable, so callers can render a placeholder rather than NaN.
 */
export function crossRate(pair: Pair, prices: UsdPrices): number | null {
  const base = pair.base === NUMERAIRE ? 1 : prices[pair.base];
  const quote = pair.quote === NUMERAIRE ? 1 : prices[pair.quote];
  if (!isUsable(base) || !isUsable(quote)) return null;
  return base / quote;
}

/** Percentage change from `from` to `to`, or null if it cannot be computed. */
export function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (!isUsable(from ?? undefined) || !isUsable(to ?? undefined)) return null;
  return ((to as number) - (from as number)) / (from as number) * 100;
}

/**
 * Join two USD series onto the timestamps of the first, matching each point to
 * the nearest point in the second, then divide. This is what lets us chart a
 * cross like XAU/EUR out of two independently sampled USD series.
 *
 * `maxGapMs` drops points whose nearest match is too far away in time, so a
 * daily series and a 5-minute series do not silently produce nonsense.
 */
export function divideSeries(
  baseSeries: SeriesPoint[],
  quoteSeries: SeriesPoint[],
  maxGapMs = 36 * 60 * 60 * 1000,
): SeriesPoint[] {
  if (baseSeries.length === 0 || quoteSeries.length === 0) return [];

  const sortedQuote = [...quoteSeries].sort((a, b) => a.t - b.t);
  const out: SeriesPoint[] = [];

  // Two-pointer walk: both series are time-ordered, so the nearest match only
  // ever moves forward.
  let j = 0;
  for (const point of [...baseSeries].sort((a, b) => a.t - b.t)) {
    while (j + 1 < sortedQuote.length && Math.abs(sortedQuote[j + 1].t - point.t) <= Math.abs(sortedQuote[j].t - point.t)) {
      j++;
    }
    const match = sortedQuote[j];
    if (Math.abs(match.t - point.t) > maxGapMs) continue;
    if (!isUsable(point.v) || !isUsable(match.v)) continue;
    out.push({ t: point.t, v: point.v / match.v });
  }

  return out;
}

/** A flat series at a constant value — the USD leg of any `X/USD` pair. */
export function constantSeries(template: SeriesPoint[], value = 1): SeriesPoint[] {
  return template.map((p) => ({ t: p.t, v: value }));
}

export type SeriesStats = {
  first: number;
  last: number;
  min: number;
  max: number;
  changePct: number | null;
};

export function seriesStats(series: SeriesPoint[]): SeriesStats | null {
  if (series.length === 0) return null;
  let min = series[0].v;
  let max = series[0].v;
  for (const p of series) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  const first = series[0].v;
  const last = series[series.length - 1].v;
  return { first, last, min, max, changePct: pctChange(first, last) };
}
