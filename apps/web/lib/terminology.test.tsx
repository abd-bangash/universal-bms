import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SessionProvider } from './session';
import { resolveTerm, useTerminology } from './terminology';
import { baseSession } from '../test/render';

describe('terminology (Requirement 28.2)', () => {
  it('resolves workspace terms and falls back to neutral defaults', () => {
    expect(resolveTerm({}, 'customer')).toBe('Customer');
    expect(resolveTerm({}, 'customer', 'plural')).toBe('Customers');
    expect(
      resolveTerm({ customer: { singular: 'Guest', plural: 'Guests' } }, 'customer', 'plural'),
    ).toBe('Guests');
    expect(resolveTerm({ customer: { singular: 'Guest', plural: 'Guests' } }, 'order')).toBe(
      'Order',
    );
  });

  it('is available as a hook that follows the signed-in workspace', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SessionProvider
        value={{
          ...baseSession,
          terminology: { productionJob: { singular: 'Workshop Job', plural: 'Workshop Jobs' } },
        }}
      >
        {children}
      </SessionProvider>
    );
    const { result } = renderHook(() => useTerminology(), { wrapper });
    expect(result.current('productionJob')).toBe('Workshop Job');
    expect(result.current('productionJob', 'plural')).toBe('Workshop Jobs');
    expect(result.current('lead')).toBe('Lead');
  });
});
