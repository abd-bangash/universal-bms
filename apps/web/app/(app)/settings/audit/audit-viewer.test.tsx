import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, page, renderWithProviders } from '@/test/render';
import { AuditViewer, dayBoundary, type AuditEvent } from './audit-viewer';

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 'e1',
  actorUserId: 'u1',
  actorType: 'USER',
  actorRole: 'Manager',
  action: 'settings.update',
  entityType: 'Workspace',
  entityId: 'w1',
  previousState: { 'sales.requiredDepositPercent': 50, 'locale.currency': 'USD' },
  newState: { 'sales.requiredDepositPercent': 30, 'locale.currency': 'PKR' },
  metadata: null,
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
  requestId: 'req-1',
  createdAt: '2026-03-04T21:30:00.000Z',
  ...over,
});

const viewer = {
  permissions: ['audit:view', 'user:view'],
  workspace: {
    id: 'w1',
    name: 'Acme',
    industryProfile: 'furniture',
    locale: { timezone: 'Asia/Karachi' },
  },
};

function setup(events: AuditEvent[]) {
  return mockApi({
    'GET /audit/events': () => page(events),
    'GET /users': () => page([{ id: 'u1', firstName: 'Mina', lastName: 'Manager' }]),
  });
}

describe('dayBoundary', () => {
  it('turns a calendar day into the instants it starts and ends in the workspace timezone', () => {
    expect(dayBoundary('2026-03-05', false, 'Asia/Karachi')).toBe('2026-03-04T19:00:00.000Z');
    expect(dayBoundary('2026-03-05', true, 'Asia/Karachi')).toBe('2026-03-05T18:59:59.999Z');
    expect(dayBoundary('2026-03-05', false, 'UTC')).toBe('2026-03-05T00:00:00.000Z');
    expect(dayBoundary('2026-07-01', false, 'America/New_York')).toBe('2026-07-01T04:00:00.000Z'); // daylight saving
    expect(dayBoundary('', false, 'UTC')).toBeUndefined();
  });
});

describe('AuditViewer', () => {
  it('lists events with the person’s name and the time in the workspace timezone', async () => {
    setup([
      event(),
      event({
        id: 'e2',
        actorUserId: null,
        actorType: 'SYSTEM',
        action: 'quotation.expired',
        entityType: 'Quotation',
        entityId: 'q1',
      }),
    ]);
    renderWithProviders(<AuditViewer />, { session: viewer });
    expect(await screen.findByText('settings.update')).toBeInTheDocument();
    expect(
      await within(await screen.findByRole('table')).findByText('Mina Manager'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('05/03/2026 02:30')).toHaveLength(2); // 21:30 UTC is 02:30 next day in Karachi
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Quotation q1')).toBeInTheDocument();
  });

  it('applies the filters, sending the day boundaries in the workspace timezone', async () => {
    const { calls } = setup([event()]);
    renderWithProviders(<AuditViewer />, { session: viewer });
    await screen.findByText('settings.update');
    await userEvent.type(screen.getByLabelText('Record type'), 'Order');
    await userEvent.type(screen.getByLabelText('Action'), 'order.create');
    await userEvent.type(screen.getByLabelText('From'), '2026-03-05');
    await userEvent.type(screen.getByLabelText('To'), '2026-03-06');
    expect(calls.at(-1)?.query.get('entityType')).toBeNull(); // nothing is sent until Filter is pressed
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await waitFor(() => expect(calls.at(-1)?.query.get('entityType')).toBe('Order'));
    const last = calls.filter((c) => c.path === '/audit/events').at(-1)!;
    expect(last.query.get('action')).toBe('order.create');
    expect(last.query.get('from')).toBe('2026-03-04T19:00:00.000Z');
    expect(last.query.get('to')).toBe('2026-03-06T18:59:59.999Z');
  });

  it('shows what changed, before and after, for an event', async () => {
    setup([event()]);
    renderWithProviders(<AuditViewer />, { session: viewer });
    await userEvent.click(await screen.findByRole('button', { name: 'View changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Changes made' });
    expect(within(dialog).getByText('Mina Manager (Manager)')).toBeInTheDocument();
    const row = within(dialog).getByRole('row', { name: /sales.requiredDepositPercent/ });
    expect(within(row).getByText('50')).toBeInTheDocument();
    expect(within(row).getByText('30')).toBeInTheDocument();
    expect(within(dialog).getByText('10.0.0.1')).toBeInTheDocument();
    expect(within(dialog).getByText('req-1')).toBeInTheDocument();
  });

  it('says so when an event recorded no field changes', async () => {
    setup([event({ previousState: null, newState: null, action: 'auth.login' })]);
    renderWithProviders(<AuditViewer />, { session: viewer });
    await userEvent.click(await screen.findByRole('button', { name: 'View changes' }));
    expect(
      await screen.findByText('No field changes were recorded for this event.'),
    ).toBeInTheDocument();
  });

  it('falls back to the id when people cannot be looked up', async () => {
    setup([event()]);
    renderWithProviders(<AuditViewer />, { session: { permissions: ['audit:view'] } });
    expect(await screen.findByText('u1')).toBeInTheDocument();
  });
});
