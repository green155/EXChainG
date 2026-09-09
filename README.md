# EXChainG

A mobile app for live exchange rates — currency pairs today, with crypto, gold
and silver already wired in.

Built with Expo (React Native) and TypeScript. No API keys, no signup, no
backend to run.

## Running it on your phone

1. Install **Expo Go** from the App Store or Google Play.
2. On your computer:

   ```bash
   npm install
   npm start
   ```

3. Scan the QR code in the terminal with your phone's camera (iOS) or from
   inside Expo Go (Android). The app opens on your phone.

Your computer and phone need to be on the same Wi-Fi. If they aren't, run
`npx expo start --tunnel` instead.

## What it does

- **Rates** — a watchlist of pairs with the live rate and its change. Pull to
  refresh; tap *Edit* to remove pairs, *+* to add one.
- **Pair detail** — tap any pair for a 1D–1Y chart, the high/low for the range,
  and the inverse rate.
- **Convert** — type an amount, get it converted between any two assets.
- **Settings** — light/dark theme, auto-refresh, haptics, and a toggle for
  whether green means up (the East Asian convention is the reverse).

Currencies, crypto and metals mix freely: `XAU/EUR` (gold in euros) and
`BTC/XAU` (bitcoin in ounces of gold) are ordinary pairs, not special cases.

## How prices work

Every price source answers exactly one question: *what does this asset cost in
USD?* Any pair is then a division:

```
EUR/GBP = usd(EUR) / usd(GBP)
BTC/XAU = usd(BTC) / usd(XAU)
```

That single numeraire is why fiat, crypto and metals are interchangeable
throughout the app, and why adding an asset class later touches one file
instead of every screen. It also keeps requests cheap — prices are fetched per
*asset*, so a watchlist of twenty pairs built from eight assets still costs two
network calls, and the converter and charts read the same cache.

### Sources

| Source | Covers | Refresh | Key needed |
| --- | --- | --- | --- |
| [Frankfurter](https://frankfurter.dev) (ECB) | Currencies | 10 min | No |
| [CoinGecko](https://www.coingecko.com) | Crypto, gold, silver | 60 s | No |

A source failing degrades only its own asset class — if CoinGecko is down, the
currency pairs still update, and the app says which feed is stale rather than
blanking the screen.

**On the metals prices.** CoinGecko has no metals endpoint, but it does quote
`xau` and `xag` among its `vs_currencies`. So the app prices a bridge coin in
both USD and XAU and divides, cancelling the coin out:

```
USD per troy oz of gold = (BTC priced in USD) / (BTC priced in XAU)
```

That yields a real spot metal price from a keyless endpoint. It is accurate
enough to watch, but it inherits CoinGecko's metal reference rather than coming
from a metals exchange. If you later want a dedicated feed (Metals-API, Twelve
Data), replace `src/sources/coingecko.ts` and nothing above the source layer
changes.

Rates are indicative mid-market prices. They exclude any spread or fees, so
they are not what you would actually be dealt.

## Adding a new asset

Add a row to `src/domain/assets.ts`:

```ts
{ id: 'XPT', code: 'XPT', name: 'Platinum', assetClass: 'metal', decimals: 2, ... }
```

If an existing source can price it, you are done — it appears in the picker,
the converter and the charts. Otherwise implement `PriceSource`
(`src/sources/types.ts`) and register it in `src/sources/registry.ts`.

## Layout

```
app/                    Screens (expo-router: file path = route)
  (tabs)/               Rates, Convert, Settings
  pair/[id].tsx         Pair detail with chart
  add-pair.tsx          Add-pair modal
src/
  domain/               Pure logic: rate math, formatting, chart geometry
  sources/              Price feeds + the registry that batches across them
  hooks/                react-query bindings
  store/                Persisted watchlist and settings (zustand)
  components/           Shared UI
  theme/                Light and dark palettes
__tests__/              Unit and render tests
```

`src/domain` is pure — no React, no network — which is why the rate math is
covered by fast tests that run anywhere.

## Development

```bash
npm test          # 67 tests: rate math, formatting, source adapters, rendering
npm run typecheck # tsc --noEmit
npm start         # dev server + QR code
```

The source adapters are tested against recorded response shapes, so if
CoinGecko or Frankfurter change their JSON, `__tests__/sources.test.ts` is what
fails first.

## Shipping to the app stores

The project is store-ready but not submitted. When you want to:

```bash
npm install -g eas-cli
eas build --platform ios      # or android
eas submit
```

Bundle identifiers are set to `com.exchaing.app` in `app.json` — change these
to your own before submitting.

## Ideas for later

- Price alerts ("tell me when EUR/USD passes 1.10") — needs push notifications.
- Home-screen widgets.
- Offline cache of the last known rates, so the list is populated on launch
  before the first request returns.
- Drag to reorder the watchlist (`move()` already exists in the store).

## Also in this repository

[`local-ai/`](local-ai/README.md) — an unrelated side project that lives here
for convenience: a private AI assistant that runs on an Apple Silicon Mac and
answers over Telegram. Nothing in the app depends on it.

```bash
./local-ai/install.sh
```
