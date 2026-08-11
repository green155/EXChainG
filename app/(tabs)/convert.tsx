import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AssetGlyph } from '../../src/components/AssetGlyph';
import { AssetPicker } from '../../src/components/AssetPicker';
import { Screen } from '../../src/components/Screen';
import { requireAsset } from '../../src/domain/assets';
import { formatAmount, formatRate, parseAmount } from '../../src/domain/format';
import { Pair } from '../../src/domain/pair';
import { usePairQuote } from '../../src/hooks/useRates';
import { useSettings } from '../../src/store/settings';
import { radius, spacing, useTheme } from '../../src/theme';

const QUICK_AMOUNTS = [10, 100, 1000, 10000];

export default function ConvertScreen() {
  const theme = useTheme();
  const haptics = useSettings((s) => s.haptics);

  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [input, setInput] = useState('100');
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  const pair = useMemo<Pair>(() => ({ base: from, quote: to }), [from, to]);
  const { quote, query } = usePairQuote(pair);

  const amount = parseAmount(input);
  const converted = amount != null && quote?.rate != null ? amount * quote.rate : null;

  const fromAsset = requireAsset(from);
  const toAsset = requireAsset(to);

  const swap = () => {
    if (haptics) Haptics.selectionAsync().catch(() => {});
    setFrom(to);
    setTo(from);
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, { color: theme.text }]}>Convert</Text>

          <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.panelLabel, { color: theme.textFaint }]}>FROM</Text>
            <View style={styles.panelRow}>
              <Pressable
                onPress={() => setPicking('from')}
                accessibilityRole="button"
                accessibilityLabel={`Change source asset, currently ${fromAsset.name}`}
                style={[styles.assetButton, { backgroundColor: theme.surfaceAlt }]}
              >
                <AssetGlyph asset={fromAsset} size={28} />
                <Text style={[styles.assetCode, { color: theme.text }]}>{fromAsset.code}</Text>
                <Ionicons name="chevron-down" size={14} color={theme.textMuted} />
              </Pressable>

              <TextInput
                value={input}
                onChangeText={setInput}
                keyboardType="decimal-pad"
                selectTextOnFocus
                accessibilityLabel="Amount to convert"
                placeholder="0"
                placeholderTextColor={theme.textFaint}
                style={[styles.input, { color: theme.text }]}
              />
            </View>
          </View>

          <View style={styles.swapRow}>
            <View style={[styles.swapLine, { backgroundColor: theme.border }]} />
            <Pressable
              onPress={swap}
              accessibilityRole="button"
              accessibilityLabel="Swap currencies"
              style={[styles.swapButton, { backgroundColor: theme.accent }]}
            >
              <Ionicons name="swap-vertical" size={20} color="#fff" />
            </Pressable>
            <View style={[styles.swapLine, { backgroundColor: theme.border }]} />
          </View>

          <View style={[styles.panel, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.panelLabel, { color: theme.textFaint }]}>TO</Text>
            <View style={styles.panelRow}>
              <Pressable
                onPress={() => setPicking('to')}
                accessibilityRole="button"
                accessibilityLabel={`Change target asset, currently ${toAsset.name}`}
                style={[styles.assetButton, { backgroundColor: theme.surfaceAlt }]}
              >
                <AssetGlyph asset={toAsset} size={28} />
                <Text style={[styles.assetCode, { color: theme.text }]}>{toAsset.code}</Text>
                <Ionicons name="chevron-down" size={14} color={theme.textMuted} />
              </Pressable>

              <Text
                style={[styles.result, { color: converted == null ? theme.textFaint : theme.text }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                accessibilityLabel={`Result ${formatAmount(converted, toAsset)}`}
              >
                {query.isLoading ? '…' : formatAmount(converted, toAsset)}
              </Text>
            </View>
          </View>

          <Text style={[styles.rateLine, { color: theme.textMuted }]}>
            1 {fromAsset.code} = {formatRate(quote?.rate, toAsset)} {toAsset.code}
          </Text>

          <View style={styles.quickRow}>
            {QUICK_AMOUNTS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setInput(String(value))}
                style={[styles.quick, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <Text style={{ color: theme.textMuted, fontWeight: '600', fontSize: 13 }}>
                  {value.toLocaleString('en-US')}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <AssetPicker
        visible={picking !== null}
        title={picking === 'from' ? 'Convert from' : 'Convert to'}
        selected={picking === 'from' ? from : to}
        exclude={picking === 'from' ? to : from}
        onClose={() => setPicking(null)}
        onSelect={(asset) => {
          if (picking === 'from') setFrom(asset.id);
          else setTo(asset.id);
          setPicking(null);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, marginBottom: spacing.lg },
  panel: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  panelLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  panelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  assetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  assetCode: { fontSize: 15, fontWeight: '700' },
  input: {
    flex: 1,
    fontSize: 30,
    fontWeight: '700',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
  result: { flex: 1, fontSize: 30, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  swapLine: { flex: 1, height: StyleSheet.hairlineWidth },
  swapButton: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  rateLine: { textAlign: 'center', marginTop: spacing.lg, fontSize: 13, fontVariant: ['tabular-nums'] },
  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, justifyContent: 'center' },
  quick: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
