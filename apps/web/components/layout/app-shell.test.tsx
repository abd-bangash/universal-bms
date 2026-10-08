import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { browser } from '@/lib/api-client';
import { NAVIGATION } from '@/lib/navigation';
import { baseSession } from '@/test/render';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/render';
import { AppShell } from './app-shell';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

const meResponse = (overrides: Record<string, unknown> = {}) =>
  jsonResponse({ data: { ...baseSession, ...overrides } });

// Navigation entries are switched on as their screens are built; here they are all on.
const originalAvailability = NAVIGATION.map((e) => e.available);
beforeAll(() => NAVIGATION.forEach((e) => ((e as { available: boolean }).available = true)));
afterAll(() =>
  NAVIGATION.forEach(
    (e, i) => ((e as { available: boolean }).available = originalAvailability[i] as boolean),
  ),
);

describe('AppShell', () => {
  it('shows a loading state, then the frame with workspace name and page', async () => {
    mockFetch(() => meResponse());
    renderWithProviders(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
      { session: null },
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(await screen.findByText('Page body')).toBeInTheDocument();
    expect(screen.getByText('Acme Furniture')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Page body');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });

  it('hides navigation the user has no permission for (Requirement 49.2)', async () => {
    mockFetch(() => meResponse({ permissions: ['customer:view', 'order:view'] }));
    renderWithProviders(
      <AppShell>
        <p>x</p>
      </AppShell>,
      { session: null },
    );
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    const links = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(links).toEqual(['Home', 'Customers', 'Orders']);
    expect(within(nav).queryByText('Settings')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Staff')).not.toBeInTheDocument();
  });

  it('hides modules the workspace switched off', async () => {
    mockFetch(() =>
      meResponse({
        permissions: ['pos:sell', 'conversation:view'],
        modules: { pos: false, messaging: true },
      }),
    );
    renderWithProviders(
      <AppShell>
        <p>x</p>
      </AppShell>,
      { session: null },
    );
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Home', 'Conversations']);
  });

  it('uses the workspace’s own words in the menu (Requirement 28.2)', async () => {
    mockFetch(() =>
      meResponse({
        permissions: ['customer:view', 'order:view'],
        terminology: {
          customer: { singular: 'Guest', plural: 'Guests' },
          order: { singular: 'Booking', plural: 'Bookings' },
        },
      }),
    );
    renderWithProviders(
      <AppShell>
        <p>x</p>
      </AppShell>,
      { session: null },
    );
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Home', 'Guests', 'Bookings']);
  });

  it('marks the current page', async () => {
    mockFetch(() => meResponse());
    renderWithProviders(
      <AppShell>
        <p>x</p>
      </AppShell>,
      { session: null },
    );
    expect(await screen.findByRole('link', { name: 'Home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers a retry when the account cannot be loaded', async () => {
    let fail = true;
    mockFetch(() =>
      fail
        ? jsonResponse(
            { statusCode: 500, code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
            500,
          )
        : meResponse(),
    );
    renderWithProviders(
      <AppShell>
        <p>Page body</p>
      </AppShell>,
      { session: null },
    );
    expect(await screen.findByText('We could not load your account.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Page body')).toBeInTheDocument();
  });

  it('has a menu button for small screens that toggles the navigation', async () => {
    mockFetch(() => meResponse());
    renderWithProviders(
      <AppShell>
        <p>x</p>
      </AppShell>,
      { session: null },
    );
    const button = await screen.findByRole('button', { name: 'Open menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows who is signed in and signs out through the BFF, then goes to login', async () => {
    const assign = jest.spyOn(browser, 'assign').mockImplementation(() => undefined);
    const fetchMock = mockFetch((url) =>
      url.endsWith('/auth/logout') ? new Response(null, { status: 204 }) : meResponse(),
    );
    renderWithProviders(
      <AppShell>
        <p>x</p>
      </AppShell>,
      { session: null },
    );
    await userEvent.click(await screen.findByLabelText('Account menu'));
    expect(screen.getByText('Signed in as Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/auth/logout'))).toBe(true),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));
    assign.mockRestore();
  });

  it('keeps the search box and bell as disabled placeholders for now', async () => {
    mockFetch(() => meResponse());
    renderWithProviders(
      <AppShell>
        <p>x</p>
      </AppShell>,
      { session: null },
    );
    expect(await screen.findByLabelText('Search')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Notifications (coming soon)' })).toBeDisabled();
  });
});
