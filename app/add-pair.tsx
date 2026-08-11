import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AssetGlyph } from '../src/components/AssetGlyph';
import { AssetPicker } from '../src/components/AssetPicker';
import { formatRate } from '../src/domain/format';
import { Pair, pairKey } from '../src/domain/pair';
import { requireAsset } from '../src/domain/assets';
import { usePairQuote } from '../src/hooks/useRates';
import { useSettings } from '../src/store/settings';
import { useWatchlist } from '../src/store/watchlist';
import { radius, spacing, useTheme } from '../src/theme';

/** A few crosses worth one tap, spanning all three asset classes. */
const SUGGESTIONS: Pair[] = [
  { base: 'EUR', quote: 'GBP' },
  { base: 'ETH', quote: 'USD' },
  { base: 'XAG', quote: 'USD' },
  { base: 'BTC', quote: 'EUR' },
  { base: 'XAU', quote: 'EUR' },
  { base: 'USD', quote: 'PLN' },
];

export default function AddPairScreen() {
  const theme = useTheme();
  const router = useRouter();
  const add = useWatchlist((s) => s.add);
  const has = useWatchlist((s) => s.has);
  const haptics = useSettings((s) => s.haptics);

  const [base, setBase] = useState('EUR');
  const [quote, setQuote] = useState('USD');
  const [picking, setPicking] = useState<'base' | 'quote' | null>(null);

  const pair: Pair = { base, quote };
  const { quote: preview } = usePairQuote(pair);
  const alreadyAdded = has(pair);

  const commit = (target: Pair) => {
    if (haptics) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    add(target);
    router.back();
  };

  const swap = () => {
    if (haptics) Haptics.selectionAsync().catch(() => {});
    setBase(quote);
    setQuote(base);
  };

  const baseAsset = requireAsset(base);
  const quoteAsset = requireAsset(quote);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
    >
      <View style={styles.selectors}>
        <Selector label="Base" assetId={base} onPress={() => setPicking('base')} />

        <Pressable
          onPress={swap}
          accessibilityRole="button"
          accessibilityLabel="Swap base and quote"
          style={[styles.swap, { backgroundColor: theme.accentSoft }]}
        >
          <Ionicons name="swap-horizontal" size={20} color={theme.accent} />
        </Pressable>

        <Selector label="Quote" assetId={quote} onPress={() => setPicking('quote')} />
      </View>

      <View style={[styles.preview, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Text style={[styles.previewLabel, { color: theme.textMuted }]}>
          1 {baseAsset.code} {baseAsset.unit ? `(${baseAsset.unit})` : ''} =
        </Text>
        <Text style={[styles.previewRate, { color: theme.text }]}>
          {formatRate(preview?.rate, quoteAsset)}{' '}
          <Text style={{ color: theme.textMuted, fontSize: 18 }}>{quoteAsset.code}</Text>
        </Text>
      </View>

      <Pressable
        onPress={() => !alreadyAdded && commit(pair)}
        disabled={alreadyAdded}
        style={[
          styles.cta,
          { backgroundColor: alreadyAdded ? theme.surfaceAlt : theme.accent },
        ]}
      >
        <Text style={[styles.ctaText, { color: alreadyAdded ? theme.textMuted : '#fff' }]}>
          {alreadyAdded ? 'Already on your watchlist' : `Add ${pairKey(pair)}`}
        </Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: theme.textFaint }]}>SUGGESTIONS</Text>
      <View style={styles.suggestions}>
        {SUGGESTIONS.map((suggestion) => {
          const key = pairKey(suggestion);
          const added = has(suggestion);
          return (
            <Pressable
              key={key}
              onPress={() => {
                setBase(suggestion.base);
                setQuote(suggestion.quote);
              }}
              style={[
                styles.suggestion,
                {
                  backgroundColor: theme.surface,
                  borderColor: added ? theme.border : theme.accent + '55',
                  opacity: added ? 0.55 : 1,
                },
              ]}
            >
              <Text style={{ color: theme.text, fontWeight: '600', fontSize: 13 }}>{key}</Text>
              {added && <Ionicons name="checkmark" size={14} color={theme.textMuted} />}
            </Pressable>
          );
        })}
      </View>

      <AssetPicker
        visible={picking !== null}
        title={picking === 'base' ? 'Base asset' : 'Quote asset'}
        selected={picking === 'base' ? base : quote}
        exclude={picking === 'base' ? quote : base}
        onClose={() => setPicking(null)}
        onSelect={(asset) => {
          if (picking === 'base') setBase(asset.id);
          else setQuote(asset.id);
          setPicking(null);
        }}
      />
    </ScrollView>
  );
}

function Selector({
  label,
  assetId,
  onPress,
}: {
  label: string;
  assetId: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const asset = requireAsset(assetId);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Change ${label.toLowerCase()} asset, currently ${asset.name}`}
      style={[styles.selector, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Text style={[styles.selectorLabel, { color: theme.textFaint }]}>{label.toUpperCase()}</Text>
      <AssetGlyph asset={asset} size={44} />
      <Text style={[styles.selectorCode, { color: theme.text }]}>{asset.code}</Text>
      <Text style={[styles.selectorName, { color: theme.textMuted }]} numberOfLines={1}>
        {asset.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  selectors: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selector: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectorLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: spacing.xs },
  selectorCode: { fontSize: 18, fontWeight: '700', marginTop: spacing.xs },
  selectorName: { fontSize: 11 },
  swap: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  preview: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  previewLabel: { fontSize: 13 },
  previewRate: { fontSize: 30, fontWeight: '800', marginTop: spacing.xs, fontVariant: ['tabular-nums'] },
  cta: {
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  ctaText: { fontWeight: '700', fontSize: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: spacing.xl, marginBottom: spacing.md },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
