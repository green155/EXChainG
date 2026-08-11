/**
 * Display formatting. Pure and unit tested.
 *
 * Rates in this app span roughly fourteen orders of magnitude — DOGE/BTC is
 * ~0.0000012 while BTC/IDR is in the billions — so a fixed decimal count is not
 * an option. We pick precision from the magnitude of the number instead.
 */

import { Asset } from './assets';

/** Decimal places that keep a number readable at any magnitude. */
export function decimalsFor(value: number, hint?: number): number {
  const abs = Math.abs(value);
  if (!Number.isFinite(abs)) return hint ?? 2;
  if (abs === 0) return hint ?? 2;
  if (abs >= 1000) return 2;
  if (abs >= 100) return Math.min(hint ?? 3, 3);
  if (abs >= 1) return hint ?? 4;
  if (abs >= 0.01) return Math.max(hint ?? 4, 5);
  // Below 0.01, keep four significant digits: 0.00012345 -> 0.0001235
  const leadingZeros = Math.floor(-Math.log10(abs));
  return Math.min(leadingZeros + 4, 12);
}

export function formatRate(value: number | null | undefined, quote?: Asset): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const decimals = decimalsFor(value, quote?.decimals);
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Money with the quote asset's glyph or ticker, for the converter result. */
export function formatAmount(value: number | null | undefined, asset?: Asset): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const decimals = decimalsFor(value, asset?.decimals);
  const body = value.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(decimals, 8),
    maximumFractionDigits: Math.min(decimals, 8),
  });
  if (!asset) return body;
  return asset.symbol ? `${asset.symbol}${body}` : `${body} ${asset.code}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** Compact "2 min ago" style stamp for the last successful refresh. */
export function formatRelativeTime(timestamp: number | null | undefined, now = Date.now()): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return 'never';
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatAxisDate(timestamp: number, rangeDays: number): string {
  const date = new Date(timestamp);
  if (rangeDays <= 2) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (rangeDays <= 365) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/** Parse converter input tolerantly: accepts "1 234,56" and "1,234.56". */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/\s/g, '');
  if (cleaned === '') return null;
  // If both separators appear, the last one is the decimal separator.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // A lone comma is a decimal separator unless it groups thousands (1,234).
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
