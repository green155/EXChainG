import { Asset, AssetClass, NUMERAIRE, getAsset } from '../domain/assets';
import { UsdPrices } from '../domain/rates';
import { PriceSource } from './types';
import { coingeckoSource } from './coingecko';
import { frankfurterSource } from './frankfurter';

/** Register a new source here and the whole app picks it up. */
export const SOURCES: PriceSource[] = [frankfurterSource, coingeckoSource];

export function sourceFor(assetClass: AssetClass): PriceSource | undefined {
  return SOURCES.find((s) => s.handles.includes(assetClass));
}

export function sourceForAsset(assetId: string): PriceSource | undefined {
  const asset = getAsset(assetId);
  return asset ? sourceFor(asset.assetClass) : undefined;
}

export type SourceBatch = {
  source: PriceSource;
  assets: Asset[];
};

/**
 * Split asset ids into one batch per source, so each source is hit once per
 * refresh no matter how many pairs reference it.
 */
export function groupBySource(assetIds: string[]): SourceBatch[] {
  const batches = new Map<string, SourceBatch>();

  for (const id of assetIds) {
    if (id === NUMERAIRE) continue; // USD is 1 by definition.
    const asset = getAsset(id);
    if (!asset) continue;
    const source = sourceFor(asset.assetClass);
    if (!source) continue;

    const batch = batches.get(source.id);
    if (batch) {
      if (!batch.assets.some((a) => a.id === asset.id)) batch.assets.push(asset);
    } else {
      batches.set(source.id, { source, assets: [asset] });
    }
  }

  return [...batches.values()];
}

export type PriceFetchResult = {
  /** Current USD price per asset. */
  prices: UsdPrices;
  /** Previous-close USD price per asset, for computing change on any cross. */
  pricesBefore: UsdPrices;
  /** Sources that failed, so the UI can say what is stale instead of blanking. */
  errors: { sourceId: string; message: string }[];
  fetchedAt: number;
};

/**
 * Fetch USD prices for every asset, in parallel across sources.
 *
 * A failing source degrades that asset class only — if CoinGecko is down, the
 * currency pairs still update.
 */
export async function fetchUsdPrices(
  assetIds: string[],
  signal?: AbortSignal,
): Promise<PriceFetchResult> {
  const batches = groupBySource(assetIds);

  const settled = await Promise.all(
    batches.map(async (batch) => {
      try {
        return { ok: true as const, quotes: await batch.source.getUsdPrices(batch.assets, signal) };
      } catch (error) {
        return {
          ok: false as const,
          sourceId: batch.source.id,
          message: error instanceof Error ? error.message : 'Request failed',
        };
      }
    }),
  );

  // USD is the numeraire: it is 1 now and it was 1 then.
  const prices: UsdPrices = { [NUMERAIRE]: 1 };
  const pricesBefore: UsdPrices = { [NUMERAIRE]: 1 };
  const errors: PriceFetchResult['errors'] = [];

  for (const result of settled) {
    if (!result.ok) {
      errors.push({ sourceId: result.sourceId, message: result.message });
      continue;
    }
    for (const [assetId, quote] of Object.entries(result.quotes)) {
      prices[assetId] = quote.usd;
      if (quote.usdBefore != null) pricesBefore[assetId] = quote.usdBefore;
    }
  }

  return { prices, pricesBefore, errors, fetchedAt: Date.now() };
}

/** How the change % should be labelled for a pair's slowest leg. */
export function changeLabelFor(assetIds: string[]): string {
  const batches = groupBySource(assetIds);
  const labels = [...new Set(batches.map((b) => b.source.changeWindowLabel))];
  if (labels.length === 0) return '24h';
  // A cross spanning both sources is only as current as its slowest leg.
  return labels.length === 1 ? labels[0] : 'recent';
}

/** Shortest refresh interval among the sources these assets need. */
export function refreshIntervalFor(assetIds: string[]): number {
  const batches = groupBySource(assetIds);
  if (batches.length === 0) return frankfurterSource.refreshMs;
  return Math.min(...batches.map((b) => b.source.refreshMs));
}
