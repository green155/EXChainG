import { memo, useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { requireAsset } from '../domain/assets';
import { formatPct, formatRate } from '../domain/format';
import { PairQuote } from '../hooks/useRates';
import { radius, spacing, useDirectionColor, useTheme } from '../theme';
import { PairGlyph } from './AssetGlyph';

type Props = {
  quote: PairQuote;
  onPress: () => void;
  onRemove?: () => void;
  editing?: boolean;
};

function PairCardImpl({ quote, onPress, onRemove, editing }: Props) {
  const theme = useTheme();
  const directionColor = useDirectionColor();
  const base = requireAsset(quote.pair.base);
  const quoteAsset = requireAsset(quote.pair.quote);

  // Flash the row when the rate changes, so an update is visible without
  // watching the digits.
  const flash = useRef(new Animated.Value(0)).current;
  const previousRate = useRef<number | null>(quote.rate);

  useEffect(() => {
    if (quote.rate == null || previousRate.current == null || quote.rate === previousRate.current) {
      previousRate.current = quote.rate;
      return;
    }
    const rising = quote.rate > previousRate.current;
    previousRate.current = quote.rate;
    flash.setValue(rising ? 1 : -1);
    Animated.timing(flash, { toValue: 0, duration: 900, useNativeDriver: false }).start();
  }, [quote.rate, flash]);

  const flashColor = flash.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [`${theme.down}26`, 'transparent', `${theme.up}26`],
  });

  const changeColor = directionColor(quote.changePct);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${base.code} to ${quoteAsset.code}, ${
        quote.rate == null ? 'rate unavailable' : formatRate(quote.rate, quoteAsset)
      }, ${quote.changePct == null ? 'no change data' : formatPct(quote.changePct)}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: flashColor, borderRadius: radius.lg }]} />

      <PairGlyph base={base} quote={quoteAsset} size={38} />

      <View style={styles.labels}>
        <Text style={[styles.pair, { color: theme.text }]}>
          {base.code}
          <Text style={{ color: theme.textFaint }}>/</Text>
          {quoteAsset.code}
        </Text>
        <Text style={[styles.name, { color: theme.textMuted }]} numberOfLines={1}>
          {base.name}
          {base.unit ? ` · per ${base.unit}` : ''}
        </Text>
      </View>

      <View style={styles.values}>
        <Text style={[styles.rate, { color: theme.text }]} numberOfLines={1}>
          {formatRate(quote.rate, quoteAsset)}
        </Text>
        <Text style={[styles.change, { color: changeColor }]}>{formatPct(quote.changePct)}</Text>
      </View>

      {editing && onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${base.code} to ${quoteAsset.code}`}
          style={[styles.remove, { backgroundColor: `${theme.danger}1F` }]}
        >
          <Text style={{ color: theme.danger, fontSize: 18, fontWeight: '700', lineHeight: 20 }}>−</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  labels: { flex: 1, minWidth: 0 },
  pair: { fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  name: { fontSize: 12, marginTop: 2 },
  values: { alignItems: 'flex-end' },
  rate: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  change: { fontSize: 13, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  remove: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export const PairCard = memo(PairCardImpl);
