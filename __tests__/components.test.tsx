/**
 * Render smoke tests.
 *
 * A bundle that builds can still crash on first paint, so these mount the
 * pieces that touch the trickiest state: a missing rate, a huge rate, and a
 * metal quoted per troy ounce.
 */

import { render, screen } from '@testing-library/react-native';
import { PairCard } from '../src/components/PairCard';
import { PairQuote } from '../src/hooks/useRates';

const quote = (overrides: Partial<PairQuote> = {}): PairQuote => ({
  pair: { base: 'EUR', quote: 'USD' },
  key: 'EUR/USD',
  rate: 1.0842,
  changePct: 0.35,
  changeLabel: '24h',
  ...overrides,
});

describe('PairCard', () => {
  it('renders a currency pair with its rate and change', () => {
    render(<PairCard quote={quote()} onPress={() => {}} />);

    expect(screen.getByText('1.0842')).toBeTruthy();
    expect(screen.getByText('+0.35%')).toBeTruthy();
    expect(screen.getByText('Euro')).toBeTruthy();
  });

  it('shows a dash instead of crashing when the rate is unavailable', () => {
    render(<PairCard quote={quote({ rate: null, changePct: null })} onPress={() => {}} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders a metal pair with its per-ounce unit', () => {
    render(
      <PairCard
        quote={quote({ pair: { base: 'XAU', quote: 'USD' }, key: 'XAU/USD', rate: 2401.55 })}
        onPress={() => {}}
      />,
    );

    expect(screen.getByText('2,401.55')).toBeTruthy();
    expect(screen.getByText(/per troy oz/)).toBeTruthy();
  });

  it('renders a crypto pair at a large magnitude', () => {
    render(
      <PairCard
        quote={quote({ pair: { base: 'BTC', quote: 'JPY' }, key: 'BTC/JPY', rate: 9_432_100.5 })}
        onPress={() => {}}
      />,
    );

    expect(screen.getByText('9,432,100.50')).toBeTruthy();
  });

  it('exposes the rate to screen readers', () => {
    render(<PairCard quote={quote()} onPress={() => {}} />);

    expect(screen.getByLabelText(/EUR to USD, 1.0842, \+0.35%/)).toBeTruthy();
  });
});
