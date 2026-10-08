import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MoneyInput, normalizeAmount } from './money-input';

describe('normalizeAmount', () => {
  it('pads and rounds half up using decimal arithmetic', () => {
    expect(normalizeAmount('12', 2)).toBe('12.00');
    expect(normalizeAmount('12.5', 2)).toBe('12.50');
    expect(normalizeAmount('2.345', 2)).toBe('2.35');
    expect(normalizeAmount('0.1', 4)).toBe('0.1000');
    expect(normalizeAmount('.5', 2)).toBe('0.50');
    expect(normalizeAmount('7.', 2)).toBe('7.00');
    expect(normalizeAmount('12345678901234567.895', 2)).toBe('12345678901234567.90');
    expect(normalizeAmount('1000', 0)).toBe('1000');
  });

  it('returns nothing for text that is not an amount', () => {
    for (const bad of ['', '-', '.', 'abc', '1e3', '1.2.3'])
      expect(normalizeAmount(bad, 2)).toBe('');
  });
});

function Harness({
  decimals = 2,
  allowNegative = false,
}: {
  decimals?: number;
  allowNegative?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="amount">Amount</label>
      <MoneyInput
        id="amount"
        value={value}
        onChange={setValue}
        decimals={decimals}
        allowNegative={allowNegative}
        currencySymbol="$"
      />
      <output data-testid="out">{value}</output>
    </>
  );
}

describe('MoneyInput', () => {
  it('accepts only digits and one decimal point', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '1a2.3.4-5');
    expect(input).toHaveValue('12.345');
    expect(screen.getByTestId('out')).toHaveTextContent('12.345');
  });

  it('tidies the amount to the currency decimals when the user leaves the field', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '19.5');
    await userEvent.tab();
    expect(input).toHaveValue('19.50');
    expect(screen.getByTestId('out')).toHaveTextContent('19.50');
  });

  it('clears an unusable entry on blur', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Amount');
    await userEvent.type(input, '.');
    await userEvent.tab();
    expect(input).toHaveValue('');
  });

  it('allows negative amounts only when asked', async () => {
    const { unmount } = render(<Harness />);
    await userEvent.type(screen.getByLabelText('Amount'), '-5');
    expect(screen.getByLabelText('Amount')).toHaveValue('5');
    unmount();
    render(<Harness allowNegative />);
    await userEvent.type(screen.getByLabelText('Amount'), '-5');
    expect(screen.getByLabelText('Amount')).toHaveValue('-5');
  });

  it('shows the currency symbol before the field', () => {
    render(<Harness />);
    expect(screen.getByText('$')).toBeInTheDocument();
  });
});
