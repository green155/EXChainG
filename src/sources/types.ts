import { Asset, AssetClass } from '../domain/assets';
import { SeriesPoint } from '../domain/rates';

/**
 * What one asset costs in USD, now and one period ago.
 *
 * Carrying the previous close here is what lets a change % work on any pair,
 * including crosses neither source quotes directly: if we know both legs' USD
 * price then and now, we know how the cross moved.
 */
export type UsdQuote = {
  usd: number;
  /** Previous close in USD. Undefined when the source cannot supply one. */
  usdBefore?: number;
};

export type UsdQuotes = Record<string, UsdQuote>;

/**
 * A price source.
 *
 * Sources do one job: given some assets, say what they cost in USD. They never
 * know about pairs — pair math happens once, in `src/domain/rates.ts`. Adding a
 * new asset class means writing one of these and registering it; no screen or
 * hook changes.
 */
export interface PriceSource {
  id: string;
  /** Human-readable attribution shown in Settings. */
  label: string;
  homepage: string;
  /** Asset classes this source can price. */
  handles: AssetClass[];
  /** How long a quote stays fresh, in ms. FX moves daily; crypto moves always. */
  refreshMs: number;
  /** What the previous close means for this source, e.g. "24h" or "prev. ECB close". */
  changeWindowLabel: string;
  /** USD price per unit for each asset it was given. Omit assets it cannot price. */
  getUsdPrices(assets: Asset[], signal?: AbortSignal): Promise<UsdQuotes>;
  /** USD price history for one asset. Optional — not every source has one. */
  getUsdHistory?(asset: Asset, days: number, signal?: AbortSignal): Promise<SeriesPoint[]>;
}

export class SourceError extends Error {
  constructor(message: string, readonly sourceId: string) {
    super(message);
    this.name = 'SourceError';
  }
}

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Fetch JSON, trying each URL in turn.
 *
 * The fallback list matters: these are free public endpoints with no SLA, and a
 * phone on a flaky connection should try the mirror before showing an error.
 */
export async function fetchJson<T>(
  urls: string[],
  sourceId: string,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;

  for (const url of urls) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), DEFAULT_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const response = await fetch(url, {
        signal: timeout.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new SourceError(`${response.status} ${response.statusText}`, sourceId);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      // The caller gave up — do not burn the remaining fallbacks.
      if (signal?.aborted) break;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new SourceError(`Could not reach ${sourceId} (${detail})`, sourceId);
}
