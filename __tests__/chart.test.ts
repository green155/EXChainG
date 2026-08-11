import { buildPaths, decimate } from '../src/domain/chart';
import { SeriesPoint } from '../src/domain/rates';

const series = (values: number[]): SeriesPoint[] => values.map((v, i) => ({ t: i * 1000, v }));

describe('buildPaths', () => {
  it('spans the full width and puts the low at the bottom', () => {
    const paths = buildPaths(series([10, 20]), 100, 50, 0);
    expect(paths).not.toBeNull();
    // Low value (10) sits at the bottom (y = height), high (20) at the top.
    expect(paths!.line).toBe('M 0.00 50.00 L 100.00 0.00');
  });

  it('respects vertical padding so the stroke is not clipped', () => {
    const paths = buildPaths(series([10, 20]), 100, 50, 5);
    expect(paths!.line).toBe('M 0.00 45.00 L 100.00 5.00');
  });

  it('draws a flat series through the middle instead of dividing by zero', () => {
    const paths = buildPaths(series([7, 7, 7]), 100, 50);
    expect(paths!.line).toBe('M 0.00 25.00 L 50.00 25.00 L 100.00 25.00');
  });

  it('closes the area path back along the baseline', () => {
    const paths = buildPaths(series([10, 20]), 100, 50, 0);
    expect(paths!.area).toBe('M 0.00 50.00 L 100.00 0.00 L 100.00 50.00 L 0.00 50.00 Z');
  });

  it('returns null when there is nothing to draw', () => {
    expect(buildPaths([], 100, 50)).toBeNull();
    expect(buildPaths(series([1]), 100, 50)).toBeNull();
    expect(buildPaths(series([1, 2]), 0, 50)).toBeNull();
    expect(buildPaths(series([1, 2]), 100, 0)).toBeNull();
  });
});

describe('decimate', () => {
  it('leaves short series untouched', () => {
    const input = series([1, 2, 3]);
    expect(decimate(input, 240)).toBe(input);
  });

  it('caps long series near the limit', () => {
    const input = series(Array.from({ length: 5000 }, (_, i) => i));
    const out = decimate(input, 240);
    expect(out.length).toBeLessThanOrEqual(241);
  });

  it('always keeps the most recent point', () => {
    const input = series(Array.from({ length: 5000 }, (_, i) => i));
    const out = decimate(input, 240);
    expect(out[out.length - 1]).toEqual(input[input.length - 1]);
  });

  it('does not duplicate the last point when it is already included', () => {
    const input = series(Array.from({ length: 10 }, (_, i) => i));
    const out = decimate(input, 5);
    const lastT = input[input.length - 1].t;
    expect(out.filter((p) => p.t === lastT)).toHaveLength(1);
  });

  it('keeps points in chronological order', () => {
    const input = series(Array.from({ length: 1000 }, (_, i) => i));
    const out = decimate(input, 100);
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
  });
});
