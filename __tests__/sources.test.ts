/**
 * These cover the source adapters against recorded response shapes. The real
 * endpoints are unreachable from CI, so the contract is pinned here instead:
 * if CoinGecko or Frankfurter change shape, these are the tests that should
 * fail first.
 */

import { requireAsset } from '../src/domain/assets';
import { coingeckoSource } from '../src/sources/coingecko';
import { frankfurterSource } from '../src/sources/frankfurter';
import { fetchUsdPrices, groupBySource, refreshIntervalFor } from '../src/sources/registry';

type Route = { match: string; body: unknown };

function mockRoutes(routes: Route[]) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: string) => {
    calls.push(String(url));
    const route = routes.find((r) => String(url).includes(r.match));
    if (!route) {
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) } as never;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => route.body } as never;
  }) as never;
  return calls;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('frankfurter source', () => {
  it('inverts "per USD" quotes into USD per unit', async () => {
    mockRoutes([
      { match: '/latest', body: { base: 'USD', date: '2026-08-10', rates: { EUR: 0.92, JPY: 155 } } },
      { match: '2026-08-09', body: { base: 'USD', date: '2026-08-09', rates: { EUR: 0.9, JPY: 150 } } },
    ]);

    const quotes = await frankfurterSource.getUsdPrices([
      requireAsset('EUR'),
      requireAsset('JPY'),
    ]);

    // 0.92 EUR per USD means one EUR costs 1/0.92 USD.
    expect(quotes.EUR.usd).toBeCloseTo(1 / 0.92, 10);
    expect(quotes.EUR.usdBefore).toBeCloseTo(1 / 0.9, 10);
    expect(quotes.JPY.usd).toBeCloseTo(1 / 155, 10);
  });

  it('asks for the day before the published date, not before today', async () => {
    const calls = mockRoutes([
      { match: '/latest', body: { base: 'USD', date: '2026-08-10', rates: { EUR: 0.92 } } },
      { match: '2026-08-09', body: { base: 'USD', date: '2026-08-07', rates: { EUR: 0.9 } } },
    ]);

    await frankfurterSource.getUsdPrices([requireAsset('EUR')]);
    expect(calls.some((url) => url.includes('/2026-08-09'))).toBe(true);
  });

  it('still returns a rate when the previous close is unavailable', async () => {
    mockRoutes([
      { match: '/latest', body: { base: 'USD', date: '2026-08-10', rates: { EUR: 0.92 } } },
      // No route for the historical call — it 404s on every fallback host.
    ]);

    const quotes = await frankfurterSource.getUsdPrices([requireAsset('EUR')]);
    expect(quotes.EUR.usd).toBeCloseTo(1 / 0.92, 10);
    expect(quotes.EUR.usdBefore).toBeUndefined();
  });

  it('never asks the API about USD, which is the numeraire', async () => {
    const calls = mockRoutes([
      { match: '/latest', body: { base: 'USD', date: '2026-08-10', rates: { EUR: 0.92 } } },
      { match: '2026-08-09', body: { base: 'USD', date: '2026-08-09', rates: { EUR: 0.9 } } },
    ]);

    await frankfurterSource.getUsdPrices([requireAsset('USD'), requireAsset('EUR')]);
    expect(calls[0]).toContain('symbols=EUR');
    expect(calls[0]).not.toContain('USD,');
  });

  it('makes no request at all when there is nothing to price', async () => {
    const calls = mockRoutes([]);
    await expect(frankfurterSource.getUsdPrices([requireAsset('USD')])).resolves.toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('drops rates that are zero or missing rather than emitting Infinity', async () => {
    mockRoutes([
      { match: '/latest', body: { base: 'USD', date: '2026-08-10', rates: { EUR: 0, JPY: 155 } } },
      { match: '2026-08-09', body: { base: 'USD', date: '2026-08-09', rates: {} } },
    ]);

    const quotes = await frankfurterSource.getUsdPrices([requireAsset('EUR'), requireAsset('JPY')]);
    expect(quotes.EUR).toBeUndefined();
    expect(quotes.JPY.usd).toBeCloseTo(1 / 155, 10);
  });

  it('converts a time series into USD-per-unit points', async () => {
    mockRoutes([
      {
        match: '..',
        body: { base: 'USD', rates: { '2026-08-08': { EUR: 0.9 }, '2026-08-07': { EUR: 0.95 } } },
      },
    ]);

    const points = await frankfurterSource.getUsdHistory!(requireAsset('EUR'), 30);
    expect(points).toHaveLength(2);
    // Sorted oldest first, regardless of object key order.
    expect(points[0].t).toBeLessThan(points[1].t);
    expect(points[0].v).toBeCloseTo(1 / 0.95, 10);
  });
});

describe('coingecko source', () => {
  const body = {
    bitcoin: { usd: 60000, usd_24h_change: 2, xau: 25, xau_24h_change: 1, xag: 2000, xag_24h_change: -1 },
    ethereum: { usd: 3000, usd_24h_change: -5 },
  };

  it('reads crypto prices and recovers the previous close from the 24h change', async () => {
    mockRoutes([{ match: 'simple/price', body }]);

    const quotes = await coingeckoSource.getUsdPrices([requireAsset('ETH')]);
    expect(quotes.ETH.usd).toBe(3000);
    // Down 5% means it was 3000 / 0.95 a day ago.
    expect(quotes.ETH.usdBefore).toBeCloseTo(3000 / 0.95, 8);
  });

  it('derives a metal price by cancelling the bridge coin', async () => {
    mockRoutes([{ match: 'simple/price', body }]);

    const quotes = await coingeckoSource.getUsdPrices([requireAsset('XAU'), requireAsset('XAG')]);
    // 60000 USD per BTC / 25 XAU per BTC = 2400 USD per troy oz.
    expect(quotes.XAU.usd).toBeCloseTo(2400, 8);
    expect(quotes.XAG.usd).toBeCloseTo(30, 8);
    // Bridge was 60000/1.02 USD and 25/1.01 XAU a day ago.
    expect(quotes.XAU.usdBefore).toBeCloseTo(60000 / 1.02 / (25 / 1.01), 8);
  });

  it('pulls in the bridge coin and metal vs-currencies in one request', async () => {
    const calls = mockRoutes([{ match: 'simple/price', body }]);

    await coingeckoSource.getUsdPrices([requireAsset('ETH'), requireAsset('XAU')]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('bitcoin');
    expect(calls[0]).toContain('ethereum');
    expect(calls[0]).toContain('xau');
    expect(calls[0]).toContain('include_24hr_change=true');
  });

  it('omits assets the response does not cover', async () => {
    mockRoutes([{ match: 'simple/price', body: { ethereum: { usd: 3000 } } }]);

    const quotes = await coingeckoSource.getUsdPrices([requireAsset('ETH'), requireAsset('BTC')]);
    expect(quotes.ETH.usd).toBe(3000);
    expect(quotes.BTC).toBeUndefined();
  });

  it('leaves the previous close undefined when the change field is missing', async () => {
    mockRoutes([{ match: 'simple/price', body: { ethereum: { usd: 3000 } } }]);

    const quotes = await coingeckoSource.getUsdPrices([requireAsset('ETH')]);
    expect(quotes.ETH.usdBefore).toBeUndefined();
  });

  it('does not emit a metal price from a zeroed bridge', async () => {
    mockRoutes([{ match: 'simple/price', body: { bitcoin: { usd: 60000, xau: 0 } } }]);

    const quotes = await coingeckoSource.getUsdPrices([requireAsset('XAU')]);
    expect(quotes.XAU).toBeUndefined();
  });
});

describe('registry', () => {
  it('batches assets so each source is called once', () => {
    const batches = groupBySource(['EUR', 'GBP', 'BTC', 'ETH', 'XAU', 'USD']);
    expect(batches).toHaveLength(2);

    const frankfurter = batches.find((b) => b.source.id === 'frankfurter')!;
    const coingecko = batches.find((b) => b.source.id === 'coingecko')!;
    expect(frankfurter.assets.map((a) => a.id)).toEqual(['EUR', 'GBP']);
    // One source covers both crypto and metals.
    expect(coingecko.assets.map((a) => a.id)).toEqual(['BTC', 'ETH', 'XAU']);
  });

  it('drops USD and unknown ids, and de-duplicates', () => {
    const batches = groupBySource(['USD', 'EUR', 'EUR', 'NOPE']);
    expect(batches).toHaveLength(1);
    expect(batches[0].assets.map((a) => a.id)).toEqual(['EUR']);
  });

  it('refreshes on the fastest-moving source in the set', () => {
    expect(refreshIntervalFor(['EUR'])).toBe(frankfurterSource.refreshMs);
    expect(refreshIntervalFor(['EUR', 'BTC'])).toBe(coingeckoSource.refreshMs);
  });

  it('keeps one asset class alive when the other source fails', async () => {
    mockRoutes([
      { match: '/latest', body: { base: 'USD', date: '2026-08-10', rates: { EUR: 0.92 } } },
      { match: '2026-08-09', body: { base: 'USD', date: '2026-08-09', rates: { EUR: 0.9 } } },
      // No CoinGecko route: that source fails outright.
    ]);

    const result = await fetchUsdPrices(['EUR', 'BTC']);
    expect(result.prices.EUR).toBeCloseTo(1 / 0.92, 10);
    expect(result.prices.BTC).toBeUndefined();
    expect(result.errors.map((e) => e.sourceId)).toEqual(['coingecko']);
  });

  it('always pins the numeraire at 1, now and before', async () => {
    mockRoutes([]);
    const result = await fetchUsdPrices(['USD']);
    expect(result.prices.USD).toBe(1);
    expect(result.pricesBefore.USD).toBe(1);
  });
});
