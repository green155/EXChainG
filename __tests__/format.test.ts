import {
  decimalsFor,
  formatPct,
  formatRate,
  formatRelativeTime,
  parseAmount,
} from '../src/domain/format';

describe('decimalsFor', () => {
  it('keeps small rates readable without losing significant digits', () => {
    expect(decimalsFor(1.0842)).toBe(4);
    expect(decimalsFor(0.0000123)).toBeGreaterThanOrEqual(8);
  });

  it('trims decimals on large numbers', () => {
    expect(decimalsFor(60123.45)).toBe(2);
    expect(decimalsFor(151.32)).toBe(3);
  });
});

describe('formatRate', () => {
  it('formats a typical FX rate to four places', () => {
    expect(formatRate(1.08423)).toBe('1.0842');
  });

  it('groups thousands for crypto', () => {
    expect(formatRate(61234.5)).toBe('61,234.50');
  });

  it('keeps four significant digits on a tiny cross', () => {
    // DOGE/BTC style — rounding to 4 decimal places would render "0.0000".
    // Precision is held at four significant digits, so the trailing zero here
    // is padding for column alignment, not lost information.
    expect(formatRate(0.00000123)).toBe('0.000001230');
    expect(formatRate(0.00000123456)).toBe('0.000001235');
  });

  it('shows a dash instead of NaN', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(undefined)).toBe('—');
    expect(formatRate(Number.NaN)).toBe('—');
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatPct', () => {
  it('signs the value', () => {
    expect(formatPct(1.234)).toBe('+1.23%');
    expect(formatPct(-1.235)).toBe('-1.24%');
    expect(formatPct(0)).toBe('0.00%');
  });

  it('handles missing data', () => {
    expect(formatPct(null)).toBe('—');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it('describes recent updates', () => {
    expect(formatRelativeTime(now - 2_000, now)).toBe('just now');
    expect(formatRelativeTime(now - 30_000, now)).toBe('30s ago');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 50 * 60 * 60_000, now)).toBe('2d ago');
  });

  it('never reports a negative age from clock skew', () => {
    expect(formatRelativeTime(now + 10_000, now)).toBe('just now');
  });

  it('handles a missing timestamp', () => {
    expect(formatRelativeTime(null, now)).toBe('never');
  });
});

describe('parseAmount', () => {
  it('parses plain numbers', () => {
    expect(parseAmount('100')).toBe(100);
    expect(parseAmount('1.5')).toBe(1.5);
  });

  it('accepts a comma as a decimal separator', () => {
    expect(parseAmount('1,5')).toBe(1.5);
    expect(parseAmount('0,25')).toBe(0.25);
  });

  it('treats a comma before exactly three digits as a thousands separator', () => {
    expect(parseAmount('1,234')).toBe(1234);
  });

  it('resolves mixed separators by which one comes last', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56')).toBe(1234.56);
  });

  it('ignores spaces used for grouping', () => {
    expect(parseAmount('1 234.56')).toBe(1234.56);
  });

  it('returns null for empty or nonsense input', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});
