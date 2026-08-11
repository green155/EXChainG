import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { SOURCES } from '../../src/sources/registry';
import { ThemePreference, useSettings } from '../../src/store/settings';
import { useWatchlist } from '../../src/store/watchlist';
import { radius, spacing, useTheme } from '../../src/theme';

const THEME_OPTIONS: { key: ThemePreference; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const resetWatchlist = useWatchlist((s) => s.reset);

  const confirmReset = () => {
    Alert.alert('Reset watchlist?', 'This restores the default pairs and removes any you added.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetWatchlist },
    ]);
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={[styles.title, { color: theme.text }]}>Settings</Text>

        <Section title="APPEARANCE">
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.text }]}>Theme</Text>
            <View style={[styles.segmented, { backgroundColor: theme.surfaceAlt }]}>
              {THEME_OPTIONS.map((option) => {
                const active = settings.themePreference === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => settings.setThemePreference(option.key)}
                    style={[
                      styles.segment,
                      active && { backgroundColor: theme.surface, borderColor: theme.border },
                    ]}
                  >
                    <Text
                      style={{
                        color: active ? theme.text : theme.textMuted,
                        fontWeight: '600',
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

          <Toggle
            label="Green means up"
            hint="Turn off for the East Asian convention, where red is a rise."
            value={settings.greenUp}
            onChange={settings.setGreenUp}
          />
        </Section>

        <Section title="BEHAVIOUR">
          <Toggle
            label="Auto-refresh"
            hint="Refresh rates while the app is open."
            value={settings.autoRefresh}
            onChange={settings.setAutoRefresh}
          />
          <Toggle
            label="Haptics"
            hint="A gentle tick when rates update."
            value={settings.haptics}
            onChange={settings.setHaptics}
          />
        </Section>

        <Section title="DATA SOURCES">
          {SOURCES.map((source) => (
            <Pressable
              key={source.id}
              onPress={() => Linking.openURL(source.homepage).catch(() => {})}
              style={styles.row}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: theme.text }]}>{source.label}</Text>
                <Text style={[styles.rowHint, { color: theme.textMuted }]}>
                  {source.handles.join(', ')} · refreshes every{' '}
                  {source.refreshMs >= 60_000
                    ? `${Math.round(source.refreshMs / 60_000)} min`
                    : `${Math.round(source.refreshMs / 1000)}s`}
                </Text>
              </View>
              <Ionicons name="open-outline" size={18} color={theme.textFaint} />
            </Pressable>
          ))}
        </Section>

        <Section title="DATA">
          <Pressable
            onPress={() => {
              queryClient.invalidateQueries();
              Alert.alert('Cache cleared', 'Rates and charts will reload.');
            }}
            style={styles.row}
          >
            <Text style={[styles.rowLabel, { color: theme.text }]}>Clear cached rates</Text>
            <Ionicons name="refresh" size={18} color={theme.textFaint} />
          </Pressable>

          <Pressable onPress={confirmReset} style={styles.row}>
            <Text style={[styles.rowLabel, { color: theme.danger }]}>Reset watchlist</Text>
            <Ionicons name="trash-outline" size={18} color={theme.danger} />
          </Pressable>
        </Section>

        <Text style={[styles.footer, { color: theme.textFaint }]}>
          EXChainG {Constants.expoConfig?.version ?? ''}
          {'\n'}
          Rates are indicative mid-market prices for information only — they are not a dealing
          quote and exclude any spread or fees.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Text style={[styles.sectionTitle, { color: theme.textFaint }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {children}
      </View>
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={[styles.rowLabel, { color: theme.text }]}>{label}</Text>
        {hint && <Text style={[styles.rowHint, { color: theme.textMuted }]}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: theme.accent, false: theme.surfaceAlt }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginBottom: spacing.sm },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, marginTop: 2, lineHeight: 16 },
  segmented: { flexDirection: 'row', borderRadius: radius.sm, padding: 2, gap: 2 },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm - 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  footer: { fontSize: 11, lineHeight: 16, marginTop: spacing.xl, textAlign: 'center' },
});
