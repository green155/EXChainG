import { useColorScheme } from 'react-native';
import { useSettings } from '../store/settings';

export type Theme = {
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  up: string;
  down: string;
  flat: string;
  danger: string;
  /** Per-asset-class accent, used for the small class badges. */
  classFiat: string;
  classCrypto: string;
  classMetal: string;
};

const dark: Theme = {
  dark: true,
  bg: '#0B0E14',
  surface: '#141922',
  surfaceAlt: '#1C2330',
  border: '#252D3B',
  text: '#F2F5FA',
  textMuted: '#93A1B8',
  textFaint: '#5D6B82',
  accent: '#4C8DFF',
  accentSoft: 'rgba(76,141,255,0.16)',
  up: '#2ECC8F',
  down: '#FF5C6C',
  flat: '#93A1B8',
  danger: '#FF5C6C',
  classFiat: '#4C8DFF',
  classCrypto: '#B478FF',
  classMetal: '#F0B429',
};

const light: Theme = {
  dark: false,
  bg: '#F5F7FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF1F7',
  border: '#DDE3EC',
  text: '#0F1723',
  textMuted: '#5B6880',
  textFaint: '#8D9AAF',
  accent: '#1F6BEB',
  accentSoft: 'rgba(31,107,235,0.10)',
  up: '#0F9D63',
  down: '#D93A4B',
  flat: '#5B6880',
  danger: '#D93A4B',
  classFiat: '#1F6BEB',
  classCrypto: '#7B3FE4',
  classMetal: '#B7791F',
};

export function useTheme(): Theme {
  const system = useColorScheme();
  const preference = useSettings((s) => s.themePreference);
  const resolved = preference === 'system' ? system ?? 'dark' : preference;
  return resolved === 'light' ? light : dark;
}

/** Direction colour, honouring the green-up / red-up setting. */
export function useDirectionColor() {
  const theme = useTheme();
  const greenUp = useSettings((s) => s.greenUp);
  return (change: number | null | undefined): string => {
    if (change == null || !Number.isFinite(change) || Math.abs(change) < 0.0001) return theme.flat;
    const positive = change > 0;
    if (greenUp) return positive ? theme.up : theme.down;
    return positive ? theme.down : theme.up;
  };
}

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 };
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
