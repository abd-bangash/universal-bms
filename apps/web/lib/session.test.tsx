import { render, screen } from '@testing-library/react';
import { Can, SessionProvider, useSession, usePermission, useWorkspaceLocale } from './session';
import { baseSession } from '../test/render';

function Probe() {
  const locale = useWorkspaceLocale();
  return (
    <>
      <span data-testid="can-view">{String(usePermission('customer:view'))}</span>
      <span data-testid="can-void">{String(usePermission('payment:void'))}</span>
      <span data-testid="currency">{locale.currency}</span>
      <span data-testid="tz">{locale.timezone}</span>
    </>
  );
}

describe('session helpers', () => {
  it('answers permission questions from the signed-in user’s permissions', () => {
    render(
      <SessionProvider value={baseSession}>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId('can-view')).toHaveTextContent('true');
    expect(screen.getByTestId('can-void')).toHaveTextContent('false');
  });

  it('merges the workspace locale over neutral defaults', () => {
    render(
      <SessionProvider
        value={{
          ...baseSession,
          workspace: {
            ...baseSession.workspace,
            locale: { currency: 'PKR', timezone: 'Asia/Karachi' },
          },
        }}
      >
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId('currency')).toHaveTextContent('PKR');
    expect(screen.getByTestId('tz')).toHaveTextContent('Asia/Karachi');
  });

  it('renders <Can> content only with the permission, else the fallback', () => {
    render(
      <SessionProvider value={baseSession}>
        <Can permission="order:view">
          <p>can see orders</p>
        </Can>
        <Can permission="payment:void" fallback={<p>no void</p>}>
          <p>can void</p>
        </Can>
      </SessionProvider>,
    );
    expect(screen.getByText('can see orders')).toBeInTheDocument();
    expect(screen.queryByText('can void')).not.toBeInTheDocument();
    expect(screen.getByText('no void')).toBeInTheDocument();
  });

  it('refuses to be used outside the signed-in shell', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    function Naked() {
      useSession();
      return null;
    }
    expect(() => render(<Naked />)).toThrow(/signed-in app shell/);
    spy.mockRestore();
  });
});
