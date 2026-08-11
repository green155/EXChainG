import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ASSETS, ASSET_CLASS_LABEL, Asset, AssetClass } from '../domain/assets';
import { radius, spacing, useTheme } from '../theme';
import { AssetGlyph } from './AssetGlyph';

const CLASS_ORDER: AssetClass[] = ['fiat', 'crypto', 'metal'];

export function searchAssets(query: string, exclude?: string): Asset[] {
  const needle = query.trim().toLowerCase();
  return ASSETS.filter((asset) => {
    if (asset.id === exclude) return false;
    if (needle === '') return true;
    return (
      asset.code.toLowerCase().includes(needle) ||
      asset.name.toLowerCase().includes(needle)
    );
  });
}

export function AssetPicker({
  visible,
  title,
  selected,
  exclude,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected?: string;
  /** Asset already used on the other side of the pair. */
  exclude?: string;
  onSelect: (asset: Asset) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AssetClass | 'all'>('all');

  const sections = useMemo(() => {
    const matches = searchAssets(query, exclude);
    return CLASS_ORDER.filter((c) => filter === 'all' || filter === c)
      .map((assetClass) => ({
        title: ASSET_CLASS_LABEL[assetClass],
        assetClass,
        data: matches.filter((a) => a.assetClass === assetClass),
      }))
      .filter((section) => section.data.length > 0);
  }, [query, exclude, filter]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={24} color={theme.textMuted} />
          </Pressable>
        </View>

        <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="search" size={17} color={theme.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search USD, Bitcoin, Gold…"
            placeholderTextColor={theme.textFaint}
            autoCorrect={false}
            autoCapitalize="characters"
            style={[styles.searchInput, { color: theme.text }]}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={17} color={theme.textFaint} />
            </Pressable>
          )}
        </View>

        <View style={styles.filters}>
          {(['all', ...CLASS_ORDER] as const).map((key) => {
            const active = filter === key;
            return (
              <Pressable
                key={key}
                onPress={() => setFilter(key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? theme.accentSoft : 'transparent',
                    borderColor: active ? theme.accent : theme.border,
                  },
                ]}
              >
                <Text style={{ color: active ? theme.accent : theme.textMuted, fontWeight: '600', fontSize: 13 }}>
                  {key === 'all' ? 'All' : ASSET_CLASS_LABEL[key]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: spacing.xxl }}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionHeader, { color: theme.textFaint, backgroundColor: theme.bg }]}>
              {section.title.toUpperCase()}
            </Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onSelect(item)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.surfaceAlt : 'transparent' },
              ]}
            >
              <AssetGlyph asset={item} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.code, { color: theme.text }]}>{item.code}</Text>
                <Text style={[styles.name, { color: theme.textMuted }]} numberOfLines={1}>
                  {item.name}
                  {item.unit ? ` · per ${item.unit}` : ''}
                </Text>
              </View>
              {selected === item.id && <Ionicons name="checkmark" size={20} color={theme.accent} />}
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={[styles.noResults, { color: theme.textMuted }]}>
              Nothing matches “{query}”.
            </Text>
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: '700' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 16, height: '100%' },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  code: { fontSize: 16, fontWeight: '700' },
  name: { fontSize: 12, marginTop: 1 },
  noResults: { textAlign: 'center', padding: spacing.xl, fontSize: 14 },
});
