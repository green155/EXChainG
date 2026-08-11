import { crossRate, divideSeries, pctChange, seriesStats } from '../src/domain/rates';

describe('crossRate', () => {
  const prices = { USD: 1, EUR: 1.1, GBP: 1.28, BTC: 60000, XAU: 2400 };

  it('reads a direct quote against the numeraire', () => {
    expect(crossRate({ base: 'EUR', quote: 'USD' }, prices)).toBeCloseTo(1.1, 10);
  });

  it('inverts when the numeraire is the base', () => {
    expect(crossRate({ base: 'USD', quote: 'EUR' }, prices)).toBeCloseTo(1 / 1.1, 10);
  });

  it('derives a cross neither source quotes directly', () => {
    expect(crossRate({ base: 'EUR', quote: 'GBP' }, prices)).toBeCloseTo(1.1 / 1.28, 10);
  });

  it('crosses asset classes — the whole point of a single numeraire', () => {
    // One bitcoin in troy ounces of gold.
    expect(crossRate({ base: 'BTC', quote: 'XAU' }, prices)).toBeCloseTo(25, 10);
    expect(crossRate({ base: 'XAU', quote: 'EUR' }, prices)).toBeCloseTo(2400 / 1.1, 10);
  });

  it('treats USD/USD as 1', () => {
    expect(crossRate({ base: 'USD', quote: 'USD' }, prices)).toBe(1);
  });

  it('returns null rather than NaN when a leg is missing or broken', () => {
    expect(crossRate({ base: 'JPY', quote: 'USD' }, prices)).toBeNull();
    expect(crossRate({ base: 'EUR', quote: 'ZZZ' }, prices)).toBeNull();
    expect(crossRate({ base: 'EUR', quote: 'X' }, { ...prices, X: 0 })).toBeNull();
    expect(crossRate({ base: 'EUR', quote: 'X' }, { ...prices, X: NaN })).toBeNull();
    expect(crossRate({ base: 'EUR', quote: 'X' }, { ...prices, X: -3 })).toBeNull();
  });
});

describe('pctChange', () => {
  it('computes a rise and a fall', () => {
    expect(pctChange(100, 110)).toBeCloseTo(10, 10);
    expect(pctChange(100, 90)).toBeCloseTo(-10, 10);
    expect(pctChange(100, 100)).toBe(0);
  });

  it('refuses to divide by an unusable base', () => {
    expect(pctChange(0, 10)).toBeNull();
    expect(pctChange(null, 10)).toBeNull();
    expect(pctChange(10, undefined)).toBeNull();
  });
});

describe('divideSeries', () => {
  const hour = 60 * 60 * 1000;

  it('divides points that share timestamps', () => {
    const base = [
      { t: 0, v: 100 },
      { t: hour, v: 110 },
    ];
    const quote = [
      { t: 0, v: 2 },
      { t: hour, v: 2.2 },
    ];
    const out = divideSeries(base, quote);
    expect(out.map((p) => p.t)).toEqual([0, hour]);
    expect(out[0].v).toBeCloseTo(50, 10);
    expect(out[1].v).toBeCloseTo(50, 10);
  });

  it('matches each base point to the nearest quote point', () => {
    // A dense crypto leg against a single daily FX point.
    const base = [
      { t: 0, v: 100 },
      { t: hour, v: 200 },
      { t: 2 * hour, v: 300 },
    ];
    const quote = [{ t: hour + 60_000, v: 10 }];
    expect(divideSeries(base, quote).map((p) => p.v)).toEqual([10, 20, 30]);
  });

  it('picks the closer of two candidates', () => {
    const base = [{ t: 10 * hour, v: 100 }];
    const quote = [
      { t: 9 * hour, v: 2 },
      { t: 10.5 * hour, v: 4 },
    ];
    // 10.5h is 0.5h away; 9h is 1h away.
    expect(divideSeries(base, quote)[0].v).toBe(25);
  });

  it('drops points whose nearest match is beyond the gap limit', () => {
    const base = [{ t: 0, v: 100 }];
    const quote = [{ t: 100 * hour, v: 2 }];
    expect(divideSeries(base, quote, hour)).toEqual([]);
  });

  it('sorts unordered input before walking it', () => {
    const base = [
      { t: 2 * hour, v: 300 },
      { t: 0, v: 100 },
    ];
    const quote = [
      { t: 2 * hour, v: 3 },
      { t: 0, v: 1 },
    ];
    expect(divideSeries(base, quote)).toEqual([
      { t: 0, v: 100 },
      { t: 2 * hour, v: 100 },
    ]);
  });

  it('skips non-positive values instead of emitting Infinity', () => {
    const base = [
      { t: 0, v: 100 },
      { t: hour, v: 110 },
    ];
    const quote = [
      { t: 0, v: 0 },
      { t: hour, v: 2 },
    ];
    expect(divideSeries(base, quote)).toEqual([{ t: hour, v: 55 }]);
  });

  it('returns empty for empty input', () => {
    expect(divideSeries([], [{ t: 0, v: 1 }])).toEqual([]);
    expect(divideSeries([{ t: 0, v: 1 }], [])).toEqual([]);
  });
});

describe('seriesStats', () => {
  it('summarises a series', () => {
    const stats = seriesStats([
      { t: 0, v: 10 },
      { t: 1, v: 15 },
      { t: 2, v: 5 },
      { t: 3, v: 12 },
    ]);
    expect(stats).toEqual({ first: 10, last: 12, min: 5, max: 15, changePct: 20 });
  });

  it('returns null for an empty series', () => {
    expect(seriesStats([])).toBeNull();
  });
});
