import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Chart } from '../../src/components/Chart';
import { PairGlyph } from '../../src/components/AssetGlyph';
import { requireAsset } from '../../src/domain/assets';
import { formatAxisDate, formatPct, formatRate, formatRelativeTime } from '../../src/domain/format';
import { invertPair, pairKey, parsePairKey } from '../../src/domain/pair';
import { seriesStats } from '../../src/domain/rates';
import { usePairHistory } from '../../src/hooks/useHistory';
import { usePairQuote } from '../../src/hooks/useRates';
import { RANGES, RangeKey, daysForRange } from '../../src/sources/history';
import { sourceForAsset } from '../../src/sources/registry';
import { useSettings } from '../../src/store/settings';
import { useWatchlist } from '../../src/store/watchlist';
import { radius, spacing, useDirectionColor, useTheme } from '../../src/theme';

export default function PairDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const directionColor = useDirectionColor();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const haptics = useSettings((s) => s.haptics);

  const add = useWatchlist((s) => s.add);
  const remove = useWatchlist((s) => s.remove);
  const watched = useWatchlist((s) => s.pairs);

  const [range, setRange] = useState<RangeKey>('1M');
  const pair = useMemo(() => parsePairKey(decodeURIComponent(id ?? '')), [id]);

  const { quote, query } = usePairQuote(pair);
  const history = usePairHistory(pair, range);

  if (!pair) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.textMuted }}>Unknown pair.</Text>
      </View>
    );
  }

  const baseAsset = requireAsset(pair.base);
  const quoteAsset = requireAsset(pair.quote);
  const inverse = quote?.rate ? 1 / quote.rate : null;
  const isWatched = watched.some((p) => p.base === pair.base && p.quote === pair.quote);

  const stats = seriesStats(history.data ?? []);
  const chartColor = directionColor(stats?.changePct ?? quote?.changePct);
  const chartWidth = width - spacing.lg * 2;

  const sourceLabels = [
    ...new Set(
      [pair.base, pair.quote]
        .map((assetId) => sourceForAsset(assetId)?.label)
        .filter((label): label is string => Boolean(label)),
    ),
  ];

  return (
    <>
      <Stack.Screen
        options={{
          title: pairKey(pair),
          headerRight: () => (
            <Pressable
              onPress={() => {
                if (haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                isWatched ? remove(pair) : add(pair);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              <Ionicons
                name={isWatched ? 'star' : 'star-outline'}
                size={22}
                color={isWatched ? theme.classMetal : theme.textMuted}
              />
            </Pressable>
          ),
        }}
      />

      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      >
        <View style={styles.hero}>
          <PairGlyph base={baseAsset} quote={quoteAsset} size={46} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroName, { color: theme.text }]} numberOfLines={1}>
              {baseAsset.name}
            </Text>
            <Text style={[styles.heroSub, { color: theme.textMuted }]}>
              priced in {quoteAsset.name}
              {baseAsset.unit ? ` · per ${baseAsset.unit}` : ''}
            </Text>
          </View>
        </View>

        <Text style={[styles.rate, { color: theme.text }]}>
          {formatRate(quote?.rate, quoteAsset)}
        </Text>
        <View style={styles.changeRow}>
          <Text style={[styles.change, { color: directionColor(quote?.changePct) }]}>
            {formatPct(quote?.changePct)}
          </Text>
          <Text style={[styles.changeLabel, { color: theme.textFaint }]}>
            {quote?.changeLabel} · updated {formatRelativeTime(query.data?.fetchedAt)}
          </Text>
        </View>

        <View style={[styles.chartCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          {history.isLoading ? (
            <View style={[styles.chartPlaceholder, { height: 180 }]}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : (history.data?.length ?? 0) >= 2 ? (
            <>
              <Chart series={history.data ?? []} color={chartColor} width={chartWidth - spacing.lg * 2} height={180} />
              <View style={styles.axis}>
                <Text style={[styles.axisText, { color: theme.textFaint }]}>
                  {formatAxisDate(history.data![0].t, daysForRange(range))}
                </Text>
                <Text style={[styles.axisText, { color: theme.textFaint }]}>
                  {formatAxisDate(history.data![history.data!.length - 1].t, daysForRange(range))}
                </Text>
              </View>
            </>
          ) : (
            <View style={[styles.chartPlaceholder, { height: 180 }]}>
              <Ionicons name="analytics-outline" size={28} color={theme.textFaint} />
              <Text style={[styles.placeholderText, { color: theme.textMuted }]}>
                {history.isError ? 'Could not load history.' : 'No history for this range yet.'}
              </Text>
            </View>
          )}

          <View style={styles.ranges}>
            {RANGES.map((option) => {
              const active = option.key === range;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setRange(option.key)}
                  style={[
                    styles.rangeChip,
                    { backgroundColor: active ? theme.accentSoft : 'transparent' },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? theme.accent : theme.textMuted,
                      fontWeight: '700',
                      fontSize: 12,
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {stats && (
          <View style={styles.statsRow}>
            <Stat label={`${range} change`} value={formatPct(stats.changePct)} color={directionColor(stats.changePct)} />
            <Stat label={`${range} low`} value={formatRate(stats.min, quoteAsset)} />
            <Stat label={`${range} high`} value={formatRate(stats.max, quoteAsset)} />
          </View>
        )}

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Row label={`1 ${baseAsset.code}`} value={`${formatRate(quote?.rate, quoteAsset)} ${quoteAsset.code}`} />
          <Row label={`1 ${quoteAsset.code}`} value={`${formatRate(inverse, baseAsset)} ${baseAsset.code}`} />
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => router.replace(`/pair/${encodeURIComponent(pairKey(invertPair(pair)))}`)}
            style={[styles.action, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Ionicons name="swap-horizontal" size={18} color={theme.accent} />
            <Text style={{ color: theme.text, fontWeight: '600' }}>View {pairKey(invertPair(pair))}</Text>
          </Pressable>
        </View>

        <Text style={[styles.attribution, { color: theme.textFaint }]}>
          Rates from {sourceLabels.join(' and ')}. Indicative mid-market prices, not a dealing quote.
        </Text>
      </ScrollView>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Text style={[styles.statLabel, { color: theme.textFaint }]}>{label}</Text>
      <Text style={[styles.statValue, { color: color ?? theme.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={{ color: theme.textMuted, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroName: { fontSize: 17, fontWeight: '700' },
  heroSub: { fontSize: 12, marginTop: 2 },
  rate: { fontSize: 42, fontWeight: '800', marginTop: spacing.lg, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  changeRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xs },
  change: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  changeLabel: { fontSize: 12 },
  chartCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chartPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  placeholderText: { fontSize: 13 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  axisText: { fontSize: 11 },
  ranges: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  rangeChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  stat: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  statValue: { fontSize: 15, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  card: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  actions: { marginTop: spacing.md },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  attribution: { fontSize: 11, marginTop: spacing.xl, lineHeight: 16, textAlign: 'center' },
});
