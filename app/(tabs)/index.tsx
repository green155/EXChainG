import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PairCard } from '../../src/components/PairCard';
import { Screen } from '../../src/components/Screen';
import { formatRelativeTime } from '../../src/domain/format';
import { pairKey } from '../../src/domain/pair';
import { usePairQuotes } from '../../src/hooks/useRates';
import { useSettings } from '../../src/store/settings';
import { useWatchlist } from '../../src/store/watchlist';
import { radius, spacing, useTheme } from '../../src/theme';

export default function RatesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const pairs = useWatchlist((s) => s.pairs);
  const remove = useWatchlist((s) => s.remove);
  const haptics = useSettings((s) => s.haptics);

  const [editing, setEditing] = useState(false);
  const { quotes, query } = usePairQuotes(pairs);

  // Re-render the "updated Xs ago" stamp without refetching.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, []);

  // A gentle tick when new numbers land, so a glance is not required.
  const lastFetchedAt = useRef<number | null>(null);
  useEffect(() => {
    const fetchedAt = query.data?.fetchedAt ?? null;
    if (fetchedAt && lastFetchedAt.current && fetchedAt !== lastFetchedAt.current && haptics) {
      Haptics.selectionAsync().catch(() => {});
    }
    lastFetchedAt.current = fetchedAt;
  }, [query.data?.fetchedAt, haptics]);

  const onRemove = useCallback(
    (index: number) => {
      if (haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      remove(pairs[index]);
    },
    [pairs, remove, haptics],
  );

  const errors = query.data?.errors ?? [];
  const hasRates = quotes.some((q) => q.rate != null);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.text }]}>Rates</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted }]}>
            {query.isFetching && !query.data
              ? 'Loading…'
              : `Updated ${formatRelativeTime(query.data?.fetchedAt)}`}
          </Text>
        </View>

        <Pressable
          onPress={() => setEditing((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={editing ? 'Finish editing watchlist' : 'Edit watchlist'}
          style={[styles.headerButton, { backgroundColor: editing ? theme.accentSoft : 'transparent' }]}
        >
          <Text style={{ color: editing ? theme.accent : theme.textMuted, fontWeight: '600' }}>
            {editing ? 'Done' : 'Edit'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/add-pair')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Add a pair"
          style={[styles.headerButton, { backgroundColor: theme.accentSoft }]}
        >
          <Ionicons name="add" size={22} color={theme.accent} />
        </Pressable>
      </View>

      {errors.length > 0 && hasRates && (
        <View style={[styles.banner, { backgroundColor: `${theme.danger}14`, borderColor: `${theme.danger}33` }]}>
          <Ionicons name="warning-outline" size={16} color={theme.danger} />
          <Text style={[styles.bannerText, { color: theme.danger }]} numberOfLines={2}>
            {errors.map((e) => e.sourceId).join(', ')} unavailable — showing last known values.
          </Text>
        </View>
      )}

      <FlatList
        data={quotes}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching && !!query.data}
            onRefresh={() => query.refetch()}
            tintColor={theme.textMuted}
            colors={[theme.accent]}
            progressBackgroundColor={theme.surface}
          />
        }
        renderItem={({ item, index }) => (
          <PairCard
            quote={item}
            editing={editing}
            onPress={() => router.push(`/pair/${encodeURIComponent(pairKey(item.pair))}`)}
            onRemove={() => onRemove(index)}
          />
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="albums-outline" size={40} color={theme.textFaint} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No pairs yet</Text>
              <Text style={[styles.emptyBody, { color: theme.textMuted }]}>
                Add a currency, crypto or metal pair to start watching it.
              </Text>
              <Pressable
                onPress={() => router.push('/add-pair')}
                style={[styles.cta, { backgroundColor: theme.accent }]}
              >
                <Text style={styles.ctaText}>Add a pair</Text>
              </Pressable>
            </View>
          )
        }
        ListFooterComponent={
          query.isError && !hasRates ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={36} color={theme.textFaint} />
              <Text style={[styles.emptyTitle, { color: theme.text }]}>Can’t reach the rate feeds</Text>
              <Text style={[styles.emptyBody, { color: theme.textMuted }]}>
                Check your connection and pull down to retry.
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  headerButton: {
    minWidth: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '500' },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    ...Platform.select({ default: {} }),
  },
  empty: { alignItems: 'center', paddingTop: spacing.xxl * 2, gap: spacing.sm },
  emptyTitle: { fontSize: 17, fontWeight: '700', marginTop: spacing.sm },
  emptyBody: { fontSize: 13, textAlign: 'center', maxWidth: 260, lineHeight: 19 },
  cta: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
