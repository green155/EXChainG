import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { buildPaths, decimate } from '../domain/chart';
import { SeriesPoint } from '../domain/rates';

export function Chart({
  series,
  color,
  width,
  height,
  fill = true,
  strokeWidth = 2,
}: {
  series: SeriesPoint[];
  color: string;
  width: number;
  height: number;
  fill?: boolean;
  strokeWidth?: number;
}) {
  const paths = useMemo(
    () => buildPaths(decimate(series), width, height, strokeWidth),
    [series, width, height, strokeWidth],
  );

  if (!paths) return <View style={{ width, height }} />;

  const gradientId = `chart-fill-${Math.round(width)}-${Math.round(height)}`;

  return (
    <Svg width={width} height={height}>
      {fill && (
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.28} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
      )}
      {fill && <Path d={paths.area} fill={`url(#${gradientId})`} />}
      <Path
        d={paths.line}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Tiny inline chart for list rows. */
export function Sparkline({
  series,
  color,
  width = 64,
  height = 28,
}: {
  series: SeriesPoint[];
  color: string;
  width?: number;
  height?: number;
}) {
  return (
    <Chart series={series} color={color} width={width} height={height} fill={false} strokeWidth={1.75} />
  );
}
