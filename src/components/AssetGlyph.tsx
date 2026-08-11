import { StyleSheet, Text, View } from 'react-native';
import { Asset, AssetClass } from '../domain/assets';
import { Theme, radius, useTheme } from '../theme';

export function classColor(theme: Theme, assetClass: AssetClass): string {
  if (assetClass === 'crypto') return theme.classCrypto;
  if (assetClass === 'metal') return theme.classMetal;
  return theme.classFiat;
}

/** Rounded tile showing an asset's glyph, tinted by asset class. */
export function AssetGlyph({ asset, size = 40 }: { asset: Asset; size?: number }) {
  const theme = useTheme();
  const color = classColor(theme, asset.assetClass);
  const glyph = asset.symbol ?? asset.code.slice(0, 2);

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: `${color}22`,
          borderColor: `${color}44`,
        },
      ]}
    >
      <Text
        style={[styles.glyph, { color, fontSize: glyph.length > 1 ? size * 0.34 : size * 0.46 }]}
        numberOfLines={1}
      >
        {glyph}
      </Text>
    </View>
  );
}

/** Overlapping pair of glyphs — base in front, quote behind. */
export function PairGlyph({ base, quote, size = 40 }: { base: Asset; quote: Asset; size?: number }) {
  const theme = useTheme();
  return (
    <View style={{ width: size * 1.45, height: size }}>
      <View style={styles.behind}>
        <View style={{ borderRadius: radius.md, borderWidth: 2, borderColor: theme.bg }}>
          <AssetGlyph asset={quote} size={size} />
        </View>
      </View>
      <View style={styles.front}>
        <AssetGlyph asset={base} size={size} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  glyph: { fontWeight: '700' },
  behind: { position: 'absolute', right: 0, top: 0 },
  front: { position: 'absolute', left: 0, top: 0 },
});
