import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityPanel } from '@/components/audit/activity-panel';
import { CommissionPercent } from '@/components/staff/commission-percent';
import { mockApi, page, renderWithProviders } from '@/test/render';
import { CommissionStatement } from './staff/commissions/commission-statement';
import { PerformanceView } from './staff/performance/performance-view';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/staff/commissions',
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  orderId: 'o1',
  orderNumber: 'ORD-2026-0001',
  salespersonId: 'u2',
  salespersonName: 'Sam Sales',
  ruleName: 'Staff commission',
  calculationBase: '2000',
  sharePercent: '100',
  amount: '200',
  status: 'PENDING',
  approvedAt: null,
  paidAt: null,
  paidMethod: null,
  note: null,
  createdAt: '2026-01-05T10:00:00.000Z',
  ...over,
});
const manager = {
  permissions: [
    'commission:view',
    'commission:view_all',
    'commission:approve',
    'commission:pay',
    'user:view',
  ],
};

describe('CommissionStatement', () => {
  it('lists commissions with status and offers approve and reject on pending ones only', async () => {
    mockApi({
      'GET /users': () => page([{ id: 'u2', firstName: 'Sam', lastName: 'Sales' }]),
      'GET /commissions': () =>
        page([
          row(),
          row({ id: 'c2', orderNumber: 'ORD-2026-0002', status: 'APPROVED' }),
          row({ id: 'c3', orderNumber: 'ORD-2026-0003', status: 'PAID' }),
        ]),
    });
    renderWithProviders(<CommissionStatement />, { session: manager });
    expect(await screen.findByText('ORD-2026-0001')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Approve commission on ORD-2026-0001' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reject commission on ORD-2026-0001' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve commission on ORD-2026-0002' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Mark the commission on ORD-2026-0002 as paid' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ORD-2026-0003/ })).not.toBeInTheDocument();
  });

  it('approves with one request', async () => {
    const { calls } = mockApi({
      'GET /commissions': () => page([row()]),
      'POST /commissions/c1/approve': () => row({ status: 'APPROVED' }),
    });
    renderWithProviders(<CommissionStatement />, { session: manager });
    await userEvent.click(await screen.findByRole('button', { name: /Approve commission/ }));
    await waitFor(() => expect(calls.some((c) => c.path === '/commissions/c1/approve')).toBe(true));
  });

  it('marks an approved commission paid, asking how it was paid', async () => {
    const { calls } = mockApi({
      'GET /commissions': () => page([row({ status: 'APPROVED' })]),
      'POST /commissions/c1/pay': () => row({ status: 'PAID' }),
    });
    renderWithProviders(<CommissionStatement />, { session: manager });
    await userEvent.click(await screen.findByRole('button', { name: /as paid/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Mark as paid' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/How it was paid/), 'Bank transfer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as paid' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/commissions/c1/pay')?.body).toEqual({
        method: 'Bank transfer',
      }),
    );
  });

  it('a salesperson sees their own and has no decision buttons', async () => {
    mockApi({ 'GET /commissions': () => page([row()]) });
    renderWithProviders(<CommissionStatement />, { session: { permissions: ['commission:view'] } });
    expect(await screen.findByText('ORD-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('You see your own commissions.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve|Reject|paid/ })).not.toBeInTheDocument();
  });

  it('shows the refusal when a decision fails', async () => {
    mockApi({
      'GET /commissions': () => page([row()]),
      'POST /commissions/c1/approve': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderWithProviders(<CommissionStatement />, { session: manager });
    await userEvent.click(await screen.findByRole('button', { name: /Approve commission/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('PerformanceView', () => {
  const perf = {
    userId: 'u1',
    leadsAssigned: 10,
    leadsWon: 4,
    conversionRate: '40',
    orders: 3,
    salesValue: '6000',
    averageOrderValue: '2000',
    commissionsPending: '100',
    commissionsApproved: '50',
    commissionsPaid: '25',
  };

  it("shows the person's own results and passes the date range", async () => {
    const { calls } = mockApi({ 'GET /staff/u1/performance': () => perf });
    renderWithProviders(<PerformanceView />, { session: { permissions: ['commission:view'] } });
    expect(await screen.findByText('Leads assigned')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('From'), '2026-01-01');
    await waitFor(() => expect(calls.at(-1)?.query.get('from')).toBe('2026-01-01T00:00:00.000Z'));
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
  });

  it('lets a manager pick any team member', async () => {
    const { calls } = mockApi({
      'GET /users': () => page([{ id: 'u2', firstName: 'Sam', lastName: 'Sales' }]),
      'GET /staff/u1/performance': () => perf,
      'GET /staff/u2/performance': () => ({ ...perf, userId: 'u2', orders: 9 }),
    });
    renderWithProviders(<PerformanceView />, { session: manager });
    await screen.findByText('Leads assigned');
    await userEvent.selectOptions(await screen.findByLabelText('Person'), 'u2');
    await waitFor(() => expect(calls.some((c) => c.path === '/staff/u2/performance')).toBe(true));
  });
});

describe('CommissionPercent', () => {
  it('shows the current percentage and saves a new one', async () => {
    const { calls } = mockApi({
      'GET /staff/u2/commission': () => ({ percent: '5', ruleId: 'r1' }),
      'PUT /staff/u2/commission': () => ({ percent: '7.5', ruleId: 'r1' }),
    });
    renderWithProviders(<CommissionPercent userId="u2" />, {
      session: { permissions: ['commission:configure'] },
    });
    const input = await screen.findByLabelText('Commission (%)');
    await waitFor(() => expect(input).toHaveValue('5'));
    await userEvent.clear(input);
    await userEvent.type(input, '7.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save commission' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ percent: '7.50' }),
    );
    expect(await screen.findByText(/set to 7.5%/)).toBeInTheDocument();
  });

  it('is not shown without commission:configure', () => {
    mockApi({});
    renderWithProviders(<CommissionPercent userId="u2" />, { session: { permissions: [] } });
    expect(screen.queryByText('Commission')).not.toBeInTheDocument();
  });
});

describe('ActivityPanel', () => {
  it("lists a record's audit events, only for people who may read the audit log", async () => {
    const { calls } = mockApi({
      'GET /audit/events': () =>
        page([
          {
            id: 'a1',
            actorUserId: 'u1',
            actorType: 'USER',
            actorRole: 'Owner',
            action: 'order.update',
            createdAt: '2026-01-05T10:00:00.000Z',
          },
        ]),
    });
    const { unmount } = renderWithProviders(<ActivityPanel entityType="Order" entityId="o1" />, {
      session: { permissions: ['audit:view'] },
    });
    expect(await screen.findByText('order.update')).toBeInTheDocument();
    expect(calls[0]?.query.get('entityType')).toBe('Order');
    expect(calls[0]?.query.get('entityId')).toBe('o1');
    unmount();
    const { calls: none } = mockApi({});
    renderWithProviders(<ActivityPanel entityType="Order" entityId="o1" />, {
      session: { permissions: [] },
    });
    expect(screen.queryByText('Activity')).not.toBeInTheDocument();
    expect(none).toHaveLength(0);
  });
});
