/**
 * CoinGecko — crypto spot prices, free, no API key.
 *
 * It also carries gold and silver, which is why this one source handles both
 * `crypto` and `metal`. CoinGecko has no metals endpoint as such; what it has
 * is `xau` and `xag` among its `vs_currencies`. So we price a bridge coin in
 * both USD and XAU and divide:
 *
 *     USD per troy oz of gold = (BTC priced in USD) / (BTC priced in XAU)
 *
 * The bridge cancels out, leaving a real spot metal price from a keyless
 * endpoint. Swapping in a dedicated metals feed later means rewriting this file
 * only — nothing above the source layer knows the difference.
 *
 * Docs: https://docs.coingecko.com/reference/introduction
 */

import { Asset } from '../domain/assets';
import { SeriesPoint, divideSeries } from '../domain/rates';
import { PriceSource, SourceError, UsdQuotes, fetchJson } from './types';

const HOST = 'https://api.coingecko.com/api/v3';

/** Deep, liquid, and always present on CoinGecko — a stable bridge asset. */
const BRIDGE_COIN = 'bitcoin';

type SimplePriceResponse = Record<string, Record<string, number>>;

type MarketChartResponse = {
  prices: [number, number][];
};

function isPositive(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Recover the price 24h ago from the current price and its percent change. */
function rewind(current: number | undefined, changePct: number | undefined): number | undefined {
  if (!isPositive(current) || typeof changePct !== 'number' || !Number.isFinite(changePct)) {
    return undefined;
  }
  const factor = 1 + changePct / 100;
  return factor > 0 ? current / factor : undefined;
}

function toSeries(prices: [number, number][] | undefined): SeriesPoint[] {
  if (!Array.isArray(prices)) return [];
  return prices
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v) && v > 0)
    .map(([t, v]) => ({ t, v }))
    .sort((a, b) => a.t - b.t);
}

export const coingeckoSource: PriceSource = {
  id: 'coingecko',
  label: 'CoinGecko',
  homepage: 'https://www.coingecko.com',
  handles: ['crypto', 'metal'],
  // Crypto trades around the clock. A minute keeps it live without tripping the
  // free tier's rate limit.
  refreshMs: 60 * 1000,
  changeWindowLabel: '24h',

  async getUsdPrices(assets, signal) {
    const coins = assets.filter((a) => a.assetClass === 'crypto' && a.coingeckoId);
    const metals = assets.filter((a) => a.assetClass === 'metal' && a.coingeckoVs);
    if (coins.length === 0 && metals.length === 0) return {};

    const ids = new Set(coins.map((a) => a.coingeckoId as string));
    const vs = new Set(['usd']);
    if (metals.length > 0) {
      ids.add(BRIDGE_COIN);
      for (const metal of metals) vs.add(metal.coingeckoVs as string);
    }

    const query =
      `${HOST}/simple/price?ids=${[...ids].join(',')}` +
      `&vs_currencies=${[...vs].join(',')}&include_24hr_change=true`;
    const data = await fetchJson<SimplePriceResponse>([query], 'coingecko', signal);

    const quotes: UsdQuotes = {};

    for (const coin of coins) {
      const entry = data[coin.coingeckoId as string];
      const usd = entry?.usd;
      if (!Number.isFinite(usd) || usd <= 0) continue;
      quotes[coin.id] = { usd, usdBefore: rewind(usd, entry?.usd_24h_change) };
    }

    if (metals.length > 0) {
      const bridge = data[BRIDGE_COIN];
      const bridgeUsd = bridge?.usd;
      const bridgeUsdBefore = rewind(bridgeUsd, bridge?.usd_24h_change);

      for (const metal of metals) {
        const vsKey = metal.coingeckoVs as string;
        const bridgeInMetal = bridge?.[vsKey];
        if (!isPositive(bridgeUsd) || !isPositive(bridgeInMetal)) continue;

        // The bridge coin cancels: (USD per BTC) / (XAU per BTC) = USD per XAU.
        const bridgeInMetalBefore = rewind(bridgeInMetal, bridge?.[`${vsKey}_24h_change`]);
        quotes[metal.id] = {
          usd: bridgeUsd / bridgeInMetal,
          usdBefore:
            isPositive(bridgeUsdBefore) && isPositive(bridgeInMetalBefore)
              ? (bridgeUsdBefore as number) / (bridgeInMetalBefore as number)
              : undefined,
        };
      }
    }

    return quotes;
  },

  async getUsdHistory(asset: Asset, days: number, signal) {
    if (asset.assetClass === 'crypto' && asset.coingeckoId) {
      const url = `${HOST}/coins/${asset.coingeckoId}/market_chart?vs_currency=usd&days=${days}`;
      const data = await fetchJson<MarketChartResponse>([url], 'coingecko', signal);
      return toSeries(data.prices);
    }

    if (asset.assetClass === 'metal' && asset.coingeckoVs) {
      // Same bridge trick as above, applied point by point.
      const [inUsd, inMetal] = await Promise.all([
        fetchJson<MarketChartResponse>(
          [`${HOST}/coins/${BRIDGE_COIN}/market_chart?vs_currency=usd&days=${days}`],
          'coingecko',
          signal,
        ),
        fetchJson<MarketChartResponse>(
          [`${HOST}/coins/${BRIDGE_COIN}/market_chart?vs_currency=${asset.coingeckoVs}&days=${days}`],
          'coingecko',
          signal,
        ),
      ]);
      // Both series are sampled by the same endpoint at the same cadence, so a
      // tight join window is safe here.
      return divideSeries(toSeries(inUsd.prices), toSeries(inMetal.prices), 60 * 60 * 1000);
    }

    throw new SourceError(`Cannot chart ${asset.code}`, 'coingecko');
  },
};
