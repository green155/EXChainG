/**
 * Frankfurter — ECB reference rates, free, no API key.
 *
 * Rates are published once per working day around 16:00 CET, so quotes are
 * "yesterday's close" outside market hours. That is expected for an ECB feed and
 * is surfaced in the UI as the timestamp on the rate, not hidden.
 *
 * Docs: https://frankfurter.dev
 */

import { Asset } from '../domain/assets';
import { SeriesPoint } from '../domain/rates';
import { PriceSource, UsdQuotes, fetchJson } from './types';

const HOSTS = ['https://api.frankfurter.app', 'https://api.frankfurter.dev/v1'];

function urls(path: string): string[] {
  return HOSTS.map((host) => `${host}${path}`);
}

type LatestResponse = {
  base: string;
  date: string;
  rates: Record<string, number>;
};

type TimeSeriesResponse = {
  base: string;
  rates: Record<string, Record<string, number>>;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const frankfurterSource: PriceSource = {
  id: 'frankfurter',
  label: 'Frankfurter (European Central Bank)',
  homepage: 'https://frankfurter.dev',
  handles: ['fiat'],
  // ECB publishes daily; ten minutes is plenty and keeps the endpoint happy.
  refreshMs: 10 * 60 * 1000,
  changeWindowLabel: 'vs prev. ECB close',

  async getUsdPrices(assets, signal) {
    // USD is the numeraire and needs no lookup.
    const symbols = assets.map((a) => a.code).filter((code) => code !== 'USD');
    if (symbols.length === 0) return {};

    const query = `/latest?base=USD&symbols=${symbols.join(',')}`;
    const latest = await fetchJson<LatestResponse>(urls(query), 'frankfurter', signal);

    // The previous publication, not "yesterday": asking for the calendar day
    // before the returned date makes Frankfurter resolve back over weekends and
    // ECB holidays to the last working day it actually published.
    const previousDay = new Date(`${latest.date}T00:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const before = await fetchJson<LatestResponse>(
      urls(`/${isoDate(previousDay)}?base=USD&symbols=${symbols.join(',')}`),
      'frankfurter',
      signal,
    ).catch(() => null); // A missing previous close only costs us the change %.

    // The response is "units of X per 1 USD"; we want USD per 1 X.
    const quotes: UsdQuotes = {};
    for (const [code, perUsd] of Object.entries(latest.rates ?? {})) {
      if (!Number.isFinite(perUsd) || perUsd <= 0) continue;
      const perUsdBefore = before?.rates?.[code];
      quotes[code] = {
        usd: 1 / perUsd,
        usdBefore:
          Number.isFinite(perUsdBefore) && (perUsdBefore as number) > 0
            ? 1 / (perUsdBefore as number)
            : undefined,
      };
    }
    return quotes;
  },

  async getUsdHistory(asset: Asset, days: number, signal) {
    if (asset.code === 'USD') return [];

    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const query = `/${isoDate(start)}..${isoDate(end)}?base=USD&symbols=${asset.code}`;
    const data = await fetchJson<TimeSeriesResponse>(urls(query), 'frankfurter', signal);

    const points: SeriesPoint[] = [];
    for (const [date, rates] of Object.entries(data.rates ?? {})) {
      const perUsd = rates?.[asset.code];
      if (!Number.isFinite(perUsd) || perUsd <= 0) continue;
      // ECB rates are a daily close; anchor them at 16:00 UTC so they line up
      // with intraday crypto samples rather than sitting at midnight.
      points.push({ t: Date.parse(`${date}T16:00:00Z`), v: 1 / perUsd });
    }
    return points.sort((a, b) => a.t - b.t);
  },
};
