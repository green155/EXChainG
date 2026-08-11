/**
 * Chart geometry. Pure and unit tested — no renderer, no React.
 */

import { SeriesPoint } from './rates';

export type ChartPaths = { line: string; area: string };

/**
 * Build the line path and the matching filled-area path for a series.
 *
 * Returns null when there is nothing to draw, so callers render a placeholder
 * instead of an SVG with a malformed `d`.
 */
export function buildPaths(
  series: SeriesPoint[],
  width: number,
  height: number,
  padding = 2,
): ChartPaths | null {
  if (series.length < 2 || width <= 0 || height <= 0) return null;

  const values = series.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerHeight = Math.max(1, height - padding * 2);

  const x = (i: number) => (i / (series.length - 1)) * width;
  // A perfectly flat series has no span to scale against — draw it mid-height
  // rather than dividing by zero.
  const y = (v: number) =>
    span === 0 ? height / 2 : padding + innerHeight - ((v - min) / span) * innerHeight;

  let line = `M ${x(0).toFixed(2)} ${y(values[0]).toFixed(2)}`;
  for (let i = 1; i < series.length; i++) {
    line += ` L ${x(i).toFixed(2)} ${y(values[i]).toFixed(2)}`;
  }

  const area = `${line} L ${width.toFixed(2)} ${height.toFixed(2)} L 0.00 ${height.toFixed(2)} Z`;
  return { line, area };
}

/**
 * Downsample to at most `max` points, so a year of five-minute samples still
 * draws in one frame. The final point is always kept — it is the one the
 * headline price label corresponds to.
 */
export function decimate(series: SeriesPoint[], max = 240): SeriesPoint[] {
  if (series.length <= max) return series;

  const step = series.length / max;
  const out: SeriesPoint[] = [];
  for (let i = 0; i < max; i++) out.push(series[Math.floor(i * step)]);

  const last = series[series.length - 1];
  if (out[out.length - 1].t !== last.t) out.push(last);
  return out;
}
