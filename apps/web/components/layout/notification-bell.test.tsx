import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, page, renderWithProviders } from '@/test/render';
import { NotificationBell } from './notification-bell';
import { POLL_MS } from '@/lib/hooks/use-notifications';

const note = (over: Record<string, unknown>) => ({
  id: 'n',
  type: 'lead.assigned',
  title: 'Lead assigned to you: Sana Malik',
  body: 'corner sofa',
  href: '/leads/l1',
  read: false,
  createdAt: '2026-03-10T09:00:00.000Z',
  ...over,
});

describe('NotificationBell', () => {
  it('shows the unread count on the bell, and nothing when there is none', async () => {
    mockApi({ 'GET /notifications/unread-count': () => ({ count: 3 }) });
    const { unmount } = renderWithProviders(<NotificationBell />);
    expect(
      await screen.findByRole('button', { name: 'Notifications, 3 unread' }),
    ).toBeInTheDocument();
    unmount();
    mockApi({ 'GET /notifications/unread-count': () => ({ count: 0 }) });
    renderWithProviders(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('shows 99+ for a very busy day', async () => {
    mockApi({ 'GET /notifications/unread-count': () => ({ count: 240 }) });
    renderWithProviders(<NotificationBell />);
    expect(
      await screen.findByRole('button', { name: 'Notifications, 240 unread' }),
    ).toHaveTextContent('99+');
  });

  it('opens the list with unread ones marked, links to the record, and marks one read when it is opened', async () => {
    let unread = 2;
    const { calls } = mockApi({
      'GET /notifications/unread-count': () => ({ count: unread }),
      'GET /notifications': () =>
        page([
          note({ id: 'a' }),
          note({ id: 'b', title: 'Task due: Call Sana', href: '/tasks', body: null, read: true }),
        ]),
      'POST /notifications/a/read': () => {
        unread = 1;
        return note({ id: 'a', read: true });
      },
    });
    renderWithProviders(<NotificationBell />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const list = await screen.findByRole('region', { name: 'Notifications' });
    const first = await within(list).findByRole('link', {
      name: /Lead assigned to you: Sana Malik/,
    });
    expect(first).toHaveAttribute('href', '/leads/l1');
    expect(first).toHaveTextContent('Unread:');
    expect(first).toHaveTextContent('corner sofa');
    const second = within(list).getByRole('link', { name: /Task due: Call Sana/ });
    expect(second).not.toHaveTextContent('Unread:');
    await user.click(first);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/notifications/a/read')).toBe(
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument(); // following a link closes the list
  });

  it('marks everything read', async () => {
    let unread = 2;
    const { calls } = mockApi({
      'GET /notifications/unread-count': () => ({ count: unread }),
      'GET /notifications': () => page([note({ id: 'a' }), note({ id: 'b' })]),
      'POST /notifications/read-all': () => {
        unread = 0;
        return { marked: 2 };
      },
    });
    renderWithProviders(<NotificationBell />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/notifications/read-all')).toBe(true));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled(),
    );
  });

  it('says so when there is nothing, and when the list cannot be loaded; Escape closes it', async () => {
    mockApi({
      'GET /notifications/unread-count': () => ({ count: 0 }),
      'GET /notifications': () => page([]),
    });
    const { unmount } = renderWithProviders(<NotificationBell />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('Nothing needs your attention.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
    unmount();
    mockApi({ 'GET /notifications/unread-count': () => ({ count: 1 }) }); // the list route answers 404
    renderWithProviders(<NotificationBell />);
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Notifications could not be loaded.',
    );
  });

  it('asks again for the count every 30 seconds', async () => {
    jest.useFakeTimers();
    try {
      let count = 0;
      const { calls } = mockApi({ 'GET /notifications/unread-count': () => ({ count: count++ }) });
      renderWithProviders(<NotificationBell />);
      await waitFor(() => expect(calls).toHaveLength(1));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(POLL_MS + 100);
      });
      await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
      expect(
        await screen.findByRole('button', { name: 'Notifications, 1 unread' }),
      ).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
