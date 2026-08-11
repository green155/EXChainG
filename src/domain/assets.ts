/**
 * The asset catalog.
 *
 * Everything the app can price lives here. Adding a new instrument — another
 * fiat currency, a coin, a metal — means adding a row to this file and nothing
 * else, as long as some source in `src/sources` knows how to price it.
 */

export type AssetClass = 'fiat' | 'crypto' | 'metal';

export type Asset = {
  /** Stable identifier used in watchlists and deep links. Uppercase ticker. */
  id: string;
  /** Ticker shown in pair labels, e.g. "EUR", "BTC", "XAU". */
  code: string;
  name: string;
  assetClass: AssetClass;
  /** Currency glyph, when the asset has a conventional one. */
  symbol?: string;
  /** Preferred display precision when this asset is the quote side of a pair. */
  decimals: number;
  /** CoinGecko coin id — required for crypto, unused elsewhere. */
  coingeckoId?: string;
  /** CoinGecko `vs_currency` code — required for metals (see coingecko source). */
  coingeckoVs?: string;
  /** Unit label for metals, which are priced per troy ounce. */
  unit?: string;
};

const fiat: Asset[] = [
  { id: 'USD', code: 'USD', name: 'US Dollar', assetClass: 'fiat', symbol: '$', decimals: 4 },
  { id: 'EUR', code: 'EUR', name: 'Euro', assetClass: 'fiat', symbol: '€', decimals: 4 },
  { id: 'GBP', code: 'GBP', name: 'British Pound', assetClass: 'fiat', symbol: '£', decimals: 4 },
  { id: 'JPY', code: 'JPY', name: 'Japanese Yen', assetClass: 'fiat', symbol: '¥', decimals: 2 },
  { id: 'CHF', code: 'CHF', name: 'Swiss Franc', assetClass: 'fiat', decimals: 4 },
  { id: 'AUD', code: 'AUD', name: 'Australian Dollar', assetClass: 'fiat', symbol: '$', decimals: 4 },
  { id: 'CAD', code: 'CAD', name: 'Canadian Dollar', assetClass: 'fiat', symbol: '$', decimals: 4 },
  { id: 'NZD', code: 'NZD', name: 'New Zealand Dollar', assetClass: 'fiat', symbol: '$', decimals: 4 },
  { id: 'CNY', code: 'CNY', name: 'Chinese Yuan', assetClass: 'fiat', symbol: '¥', decimals: 4 },
  { id: 'HKD', code: 'HKD', name: 'Hong Kong Dollar', assetClass: 'fiat', symbol: '$', decimals: 4 },
  { id: 'SGD', code: 'SGD', name: 'Singapore Dollar', assetClass: 'fiat', symbol: '$', decimals: 4 },
  { id: 'SEK', code: 'SEK', name: 'Swedish Krona', assetClass: 'fiat', decimals: 4 },
  { id: 'NOK', code: 'NOK', name: 'Norwegian Krone', assetClass: 'fiat', decimals: 4 },
  { id: 'DKK', code: 'DKK', name: 'Danish Krone', assetClass: 'fiat', decimals: 4 },
  { id: 'PLN', code: 'PLN', name: 'Polish Zloty', assetClass: 'fiat', decimals: 4 },
  { id: 'CZK', code: 'CZK', name: 'Czech Koruna', assetClass: 'fiat', decimals: 4 },
  { id: 'HUF', code: 'HUF', name: 'Hungarian Forint', assetClass: 'fiat', decimals: 2 },
  { id: 'RON', code: 'RON', name: 'Romanian Leu', assetClass: 'fiat', decimals: 4 },
  { id: 'BGN', code: 'BGN', name: 'Bulgarian Lev', assetClass: 'fiat', decimals: 4 },
  { id: 'TRY', code: 'TRY', name: 'Turkish Lira', assetClass: 'fiat', symbol: '₺', decimals: 4 },
  { id: 'ILS', code: 'ILS', name: 'Israeli Shekel', assetClass: 'fiat', symbol: '₪', decimals: 4 },
  { id: 'ISK', code: 'ISK', name: 'Icelandic Krona', assetClass: 'fiat', decimals: 2 },
  { id: 'INR', code: 'INR', name: 'Indian Rupee', assetClass: 'fiat', symbol: '₹', decimals: 4 },
  { id: 'IDR', code: 'IDR', name: 'Indonesian Rupiah', assetClass: 'fiat', decimals: 2 },
  { id: 'KRW', code: 'KRW', name: 'South Korean Won', assetClass: 'fiat', symbol: '₩', decimals: 2 },
  { id: 'MYR', code: 'MYR', name: 'Malaysian Ringgit', assetClass: 'fiat', decimals: 4 },
  { id: 'PHP', code: 'PHP', name: 'Philippine Peso', assetClass: 'fiat', symbol: '₱', decimals: 4 },
  { id: 'THB', code: 'THB', name: 'Thai Baht', assetClass: 'fiat', symbol: '฿', decimals: 4 },
  { id: 'ZAR', code: 'ZAR', name: 'South African Rand', assetClass: 'fiat', decimals: 4 },
  { id: 'MXN', code: 'MXN', name: 'Mexican Peso', assetClass: 'fiat', symbol: '$', decimals: 4 },
  { id: 'BRL', code: 'BRL', name: 'Brazilian Real', assetClass: 'fiat', symbol: 'R$', decimals: 4 },
];

const crypto: Asset[] = [
  { id: 'BTC', code: 'BTC', name: 'Bitcoin', assetClass: 'crypto', symbol: '₿', decimals: 2, coingeckoId: 'bitcoin' },
  { id: 'ETH', code: 'ETH', name: 'Ethereum', assetClass: 'crypto', symbol: 'Ξ', decimals: 2, coingeckoId: 'ethereum' },
  { id: 'USDT', code: 'USDT', name: 'Tether', assetClass: 'crypto', decimals: 4, coingeckoId: 'tether' },
  { id: 'USDC', code: 'USDC', name: 'USD Coin', assetClass: 'crypto', decimals: 4, coingeckoId: 'usd-coin' },
  { id: 'BNB', code: 'BNB', name: 'BNB', assetClass: 'crypto', decimals: 2, coingeckoId: 'binancecoin' },
  { id: 'SOL', code: 'SOL', name: 'Solana', assetClass: 'crypto', decimals: 2, coingeckoId: 'solana' },
  { id: 'XRP', code: 'XRP', name: 'XRP', assetClass: 'crypto', decimals: 4, coingeckoId: 'ripple' },
  { id: 'ADA', code: 'ADA', name: 'Cardano', assetClass: 'crypto', decimals: 4, coingeckoId: 'cardano' },
  { id: 'DOGE', code: 'DOGE', name: 'Dogecoin', assetClass: 'crypto', decimals: 6, coingeckoId: 'dogecoin' },
  { id: 'TRX', code: 'TRX', name: 'TRON', assetClass: 'crypto', decimals: 6, coingeckoId: 'tron' },
  { id: 'TON', code: 'TON', name: 'Toncoin', assetClass: 'crypto', decimals: 4, coingeckoId: 'the-open-network' },
  { id: 'AVAX', code: 'AVAX', name: 'Avalanche', assetClass: 'crypto', decimals: 2, coingeckoId: 'avalanche-2' },
  { id: 'DOT', code: 'DOT', name: 'Polkadot', assetClass: 'crypto', decimals: 4, coingeckoId: 'polkadot' },
  { id: 'MATIC', code: 'MATIC', name: 'Polygon', assetClass: 'crypto', decimals: 4, coingeckoId: 'matic-network' },
  { id: 'LINK', code: 'LINK', name: 'Chainlink', assetClass: 'crypto', decimals: 2, coingeckoId: 'chainlink' },
  { id: 'LTC', code: 'LTC', name: 'Litecoin', assetClass: 'crypto', decimals: 2, coingeckoId: 'litecoin' },
  { id: 'BCH', code: 'BCH', name: 'Bitcoin Cash', assetClass: 'crypto', decimals: 2, coingeckoId: 'bitcoin-cash' },
  { id: 'ATOM', code: 'ATOM', name: 'Cosmos', assetClass: 'crypto', decimals: 2, coingeckoId: 'cosmos' },
  { id: 'XLM', code: 'XLM', name: 'Stellar', assetClass: 'crypto', decimals: 6, coingeckoId: 'stellar' },
  { id: 'ETC', code: 'ETC', name: 'Ethereum Classic', assetClass: 'crypto', decimals: 2, coingeckoId: 'ethereum-classic' },
];

const metals: Asset[] = [
  {
    id: 'XAU',
    code: 'XAU',
    name: 'Gold',
    assetClass: 'metal',
    decimals: 2,
    coingeckoVs: 'xau',
    unit: 'troy oz',
  },
  {
    id: 'XAG',
    code: 'XAG',
    name: 'Silver',
    assetClass: 'metal',
    decimals: 2,
    coingeckoVs: 'xag',
    unit: 'troy oz',
  },
];

export const ASSETS: Asset[] = [...fiat, ...crypto, ...metals];

const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

export function getAsset(id: string): Asset | undefined {
  return BY_ID.get(id);
}

/** Throws for unknown ids — use when the id is known to come from the catalog. */
export function requireAsset(id: string): Asset {
  const asset = BY_ID.get(id);
  if (!asset) throw new Error(`Unknown asset: ${id}`);
  return asset;
}

export function assetsByClass(assetClass: AssetClass): Asset[] {
  return ASSETS.filter((a) => a.assetClass === assetClass);
}

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  fiat: 'Currencies',
  crypto: 'Crypto',
  metal: 'Metals',
};

/** The numeraire every source prices against. See `src/sources/types.ts`. */
export const NUMERAIRE = 'USD';
