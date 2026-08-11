import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export function Screen({
  children,
  edges = ['top'],
}: {
  children: ReactNode;
  edges?: Edge[];
}) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.bg }]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

export function Divider() {
  const theme = useTheme();
  return <View style={[styles.divider, { backgroundColor: theme.border }]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, width: '100%' },
});
