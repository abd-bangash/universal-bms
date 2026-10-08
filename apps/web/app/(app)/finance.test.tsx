import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, page, renderWithProviders } from '@/test/render';
import type { OrderView } from '@/lib/hooks/use-sales';
import type { PaymentView } from '@/lib/hooks/use-finance';
import { PaymentsPanel } from '@/components/finance/payments-panel';
import { RecordPaymentDialog } from '@/components/finance/record-payment-dialog';
import { AccountsManager } from './finance/accounts/accounts-manager';
import { ExpenseList } from './finance/expenses/expense-list';
import { PaymentList } from './finance/payments/payment-list';
import { ReceivablesPage } from './finance/receivables/receivables-view';
import { OrderDetail } from './orders/order-detail';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/finance/payments',
}));

const payment = (over: Partial<PaymentView> = {}): PaymentView => ({
  id: 'p1',
  paymentNumber: 'PAY-2026-00001',
  type: 'DEPOSIT',
  status: 'CONFIRMED',
  orderId: 'o1',
  customerId: 'c1',
  paymentMethodId: 'm-cash',
  amount: '600',
  paidAt: '2026-10-02T10:00:00.000Z',
  referenceNumber: null,
  note: null,
  rejectedReason: null,
  voidReason: null,
  ...over,
});

const order = (over: Partial<OrderView> = {}): OrderView => ({
  id: 'o1',
  orderNumber: 'ORD-2026-0001',
  customerId: 'c1',
  leadId: null,
  quotationId: null,
  orderType: 'STANDARD',
  source: 'MANUAL',
  status: 'confirmed',
  paymentStatus: 'UNPAID',
  orderDate: '2026-10-01T10:00:00.000Z',
  subtotal: '2000',
  discountType: null,
  discountValue: '0',
  discountAmount: '0',
  taxAmount: '0',
  totalAmount: '2000',
  depositRequired: '600',
  paidAmount: '0',
  refundedAmount: '0',
  balanceDue: '2000',
  fulfilmentMethod: null,
  deliveryAddress: null,
  scheduledAt: null,
  deliveredAt: null,
  receiverName: null,
  notes: null,
  internalNotes: null,
  cancelReason: null,
  version: 1,
  items: [],
  allowedTransitions: [],
  ...over,
});

const methods = [
  {
    id: 'm-cash',
    name: 'Cash',
    type: 'CASH',
    accountId: 'a1',
    requiresReference: false,
    active: true,
  },
  {
    id: 'm-bank',
    name: 'Bank transfer',
    type: 'BANK_TRANSFER',
    accountId: 'a2',
    requiresReference: true,
    active: true,
  },
];
const accounts = [
  { id: 'a1', type: 'CASH', name: 'Cash', showToCustomers: false, active: true },
  {
    id: 'a2',
    type: 'BANK',
    name: 'HBL current',
    showToCustomers: true,
    active: true,
    bankName: 'HBL',
    accountNumber: 'PK00',
  },
];

const base = {
  'GET /settings/payment-methods': () => methods,
  'GET /settings/financial-accounts': () => accounts,
  'GET /settings/expense-categories': () => [{ id: 'cat1', name: 'Rent', active: true }],
  'GET /fields': () => [],
};
const owner = {
  permissions: [
    'payment:view',
    'payment:create',
    'payment:confirm',
    'payment:void',
    'expense:view',
    'expense:create',
    'expense:void',
    'account:view',
    'account:configure',
    'order:view',
    'order:edit',
    'customer:view',
    'task:view',
  ],
};

describe('PaymentList', () => {
  const rows = () =>
    page([
      payment(),
      payment({
        id: 'p2',
        paymentNumber: 'PAY-2026-00002',
        status: 'PENDING_VERIFICATION',
        amount: '300',
      }),
    ]);

  it('lists payments; pending ones can be confirmed or rejected, confirmed ones voided', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /payments': rows,
      'POST /payments/p2/confirm': () => payment({ id: 'p2' }),
    });
    renderWithProviders(<PaymentList />, { session: owner });
    expect(await screen.findByText('PAY-2026-00001')).toBeInTheDocument();
    const pendingRow = screen.getByText('PAY-2026-00002').closest('tr') as HTMLElement;
    expect(within(pendingRow).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    const confirmedRow = screen.getByText('PAY-2026-00001').closest('tr') as HTMLElement;
    expect(within(confirmedRow).getByRole('button', { name: 'Void' })).toBeInTheDocument();
    expect(within(confirmedRow).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    await userEvent.click(within(pendingRow).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/payments/p2/confirm')).toBe(
        true,
      ),
    );
  });

  it('voiding needs a reason', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /payments': rows,
      'POST /payments/p1/void': () => payment({ status: 'VOIDED' }),
    });
    renderWithProviders(<PaymentList />, { session: owner });
    const row = (await screen.findByText('PAY-2026-00001')).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Void' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Void payment PAY-2026-00001',
      hidden: true,
    });
    const confirm = within(dialog).getByRole('button', { name: 'Void the payment', hidden: true });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Entered twice');
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/payments/p1/void')?.body).toEqual({
        reason: 'Entered twice',
      }),
    );
  });

  it('shows no confirm or void actions to someone who may only record payments', async () => {
    mockApi({ ...base, 'GET /payments': rows });
    renderWithProviders(<PaymentList />, {
      session: { permissions: ['payment:view', 'payment:create'] },
    });
    await screen.findByText('PAY-2026-00001');
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });
});

describe('RecordPaymentDialog', () => {
  const fetchBody = (fetchMock: jest.Mock) =>
    fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

  it('records an order payment with an Idempotency-Key; a bank method needs its reference number', async () => {
    const { fetchMock, calls } = mockApi({ ...base, 'POST /payments': () => payment() });
    renderWithProviders(
      <RecordPaymentDialog
        open
        onClose={jest.fn()}
        order={{ id: 'o1', orderNumber: 'ORD-2026-0001', customerId: 'c1' }}
        suggestedAmount="600"
      />,
      { session: owner },
    );
    await screen.findByRole('option', { name: 'Bank transfer' });
    await userEvent.selectOptions(screen.getByLabelText(/Payment method/), 'm-bank');
    const submit = screen.getByRole('button', { name: 'Record payment' });
    expect(submit).toBeDisabled(); // reference missing
    await userEvent.type(screen.getByLabelText(/Reference number/), 'TX-77');
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/payments' && c.method === 'POST')).toBe(true),
    );
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      type: 'DEPOSIT',
      orderId: 'o1',
      paymentMethodId: 'm-bank',
      amount: '600',
      referenceNumber: 'TX-77',
    });
    const [, init] = fetchBody(fetchMock)[0]!;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });

  it('tells a person who cannot confirm that the payment will wait', async () => {
    mockApi({ ...base });
    renderWithProviders(
      <RecordPaymentDialog
        open
        onClose={jest.fn()}
        order={{ id: 'o1', orderNumber: 'X', customerId: 'c1' }}
      />,
      {
        session: { permissions: ['payment:view', 'payment:create'] },
      },
    );
    expect(await screen.findByText(/has to confirm it before it counts/)).toBeInTheDocument();
  });
});

describe('PaymentsPanel on the order page', () => {
  it('lists the order’s payments and offers recording, credit and overpayment actions as they apply', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /payments': () => page([payment()]),
      'GET /customers/c1/credit': () => ({ balance: '500', entries: [] }),
      'POST /customers/c1/credit/apply': () => payment({ type: 'CREDIT_APPLIED' }),
    });
    renderWithProviders(
      <PaymentsPanel order={order({ balanceDue: '1400', paidAmount: '600' })} />,
      { session: owner },
    );
    expect(await screen.findByText(/PAY-2026-00001/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Use customer credit/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/customers/c1/credit/apply')?.body).toEqual({
        orderId: 'o1',
        amount: '500',
      }),
    );
  });

  it('flags an overpayment and moves it to credit', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /payments': () => page([payment({ amount: '2300' })]),
      'GET /customers/c1/credit': () => ({ balance: '0', entries: [] }),
      'POST /orders/o1/overpayment-to-credit': () => payment({ type: 'REFUND' }),
    });
    renderWithProviders(
      <PaymentsPanel
        order={order({ balanceDue: '-300', paidAmount: '2300', paymentStatus: 'OVERPAID' })}
      />,
      { session: owner },
    );
    expect(await screen.findByText(/overpaid by/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /overpayment to credit/ }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/orders/o1/overpayment-to-credit')).toBe(true),
    );
  });

  it('shows nothing, and asks for nothing, to someone without payment:view', async () => {
    const { calls } = mockApi({ ...base });
    renderWithProviders(<PaymentsPanel order={order()} />, {
      session: { permissions: ['order:view'] },
    });
    expect(screen.queryByRole('heading', { name: 'Payments' })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/payments')).toHaveLength(0);
  });

  it('cancelling a paid order asks what happens to the money', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /workflows/ORDER': () => ({
        states: [
          {
            key: 'confirmed',
            label: 'Confirmed',
            color: '#000',
            category: 'IN_PROGRESS',
            systemRole: 'CONFIRMED',
            active: true,
          },
          {
            key: 'cancelled',
            label: 'Cancelled',
            color: '#000',
            category: 'CANCELLED',
            systemRole: 'CANCELLED',
            active: true,
          },
        ],
      }),
      'GET /orders/o1': () =>
        order({
          paidAmount: '600',
          balanceDue: '1400',
          allowedTransitions: [
            {
              to: 'cancelled',
              requiredPermission: 'order:cancel',
              requiredFields: [],
              requiresApproval: false,
            },
          ],
        }),
      'GET /customers/c1': () => ({ id: 'c1', fullName: 'Sana' }),
      'GET /orders/o1/status-history': () => [],
      'GET /orders/o1/invoices': () => [],
      'GET /orders/o1/timeline': () => page([]),
      'GET /payments': () => page([]),
      'GET /customers/c1/credit': () => ({ balance: '0', entries: [] }),
      'GET /notes': () => [],
      'GET /tasks': () => page([]),
      'POST /orders/o1/status': () => ({
        order: order({ status: 'cancelled' }),
        pendingApproval: false,
      }),
    });
    renderWithProviders(<OrderDetail orderId="o1" />, { session: owner });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelled' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this order', hidden: true });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Changed mind');
    const confirm = within(dialog).getByRole('button', { name: 'Cancel the order', hidden: true });
    expect(confirm).toBeDisabled(); // the money has to be accounted for
    await userEvent.click(within(dialog).getByRole('checkbox', { hidden: true }));
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/orders/o1/status')?.body).toEqual({
        status: 'cancelled',
        reason: 'Changed mind',
        paymentDecision: 'CREDIT',
      }),
    );
  });
});

describe('ExpenseList', () => {
  const expense = {
    id: 'e1',
    categoryId: 'cat1',
    amount: '45000',
    expenseDate: '2026-03-01T00:00:00.000Z',
    paymentMethodId: 'm-cash',
    description: 'March rent',
    status: 'POSTED',
    voidReason: null,
  };

  it('lists expenses and records a new one', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /expenses': () => page([expense]),
      'POST /expenses': () => expense,
    });
    renderWithProviders(<ExpenseList />, { session: owner });
    expect(await screen.findByText('March rent')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an expense', hidden: true });
    await within(dialog).findByRole('option', { name: 'Rent', hidden: true });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Category/), 'cat1');
    await userEvent.type(within(dialog).getByLabelText(/^Amount/), '1200');
    await within(dialog).findByRole('option', { name: 'Cash', hidden: true });
    await userEvent.selectOptions(within(dialog).getByLabelText(/Paid with/), 'm-cash');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save expense', hidden: true }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/expenses')?.body).toMatchObject({
        categoryId: 'cat1',
        paymentMethodId: 'm-cash',
        amount: '1200.00',
      }),
    );
  });

  it('voiding needs a reason, and only people with expense:void see it', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /expenses': () => page([expense]),
      'POST /expenses/e1/void': () => ({ ...expense, status: 'VOIDED' }),
    });
    const { unmount } = renderWithProviders(<ExpenseList />, {
      session: { permissions: ['expense:view'] },
    });
    await screen.findByText('March rent');
    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<ExpenseList />, { session: owner });
    await userEvent.click(await screen.findByRole('button', { name: 'Void' }));
    const dialog = screen.getByRole('dialog', { name: 'Void this expense', hidden: true });
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Duplicate');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Void the expense', hidden: true }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/expenses/e1/void')?.body).toEqual({
        reason: 'Duplicate',
      }),
    );
  });
});

describe('ReceivablesPage', () => {
  it('shows who owes what, with the ageing', async () => {
    mockApi({
      ...base,
      'GET /payments/receivables-summary': () => ({
        customers: [
          {
            customerId: 'c1',
            customerName: 'Bilal Ahmed',
            orders: 1,
            invoiced: '5000',
            paid: '1000',
            outstanding: '4000',
            ageing: { current: '0', days31to60: '0', days61to90: '0', over90: '4000' },
          },
        ],
        totals: { invoiced: '5000', paid: '1000', outstanding: '4000' },
      }),
    });
    renderWithProviders(<ReceivablesPage />, { session: owner });
    expect(await screen.findByRole('link', { name: 'Bilal Ahmed' })).toHaveAttribute(
      'href',
      '/customers/c1',
    );
    expect(screen.getAllByText(/4,000/).length).toBeGreaterThan(0);
    expect(screen.getByText('Over 90 days')).toBeInTheDocument();
  });
});

describe('AccountsManager', () => {
  it('shows accounts and methods; only people who configure see the buttons', async () => {
    mockApi({ ...base });
    const { unmount } = renderWithProviders(<AccountsManager />, {
      session: { permissions: ['account:view'] },
    });
    expect(await screen.findByText('HBL current')).toBeInTheDocument();
    expect(screen.getByText('Shown to customers')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add account' })).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<AccountsManager />, { session: owner });
    expect(await screen.findByRole('button', { name: 'Add account' })).toBeInTheDocument();
  });

  it('adds a bank account with its details', async () => {
    const { calls } = mockApi({ ...base, 'POST /settings/financial-accounts': () => accounts[1] });
    renderWithProviders(<AccountsManager />, { session: owner });
    await userEvent.click(await screen.findByRole('button', { name: 'Add account' }));
    await userEvent.type(screen.getByLabelText(/^Name/), 'Meezan');
    await userEvent.type(screen.getByLabelText('Bank'), 'Meezan Bank');
    await userEvent.type(screen.getByLabelText(/Account number/), 'PK11');
    await userEvent.click(screen.getByLabelText(/Show on documents/));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/settings/financial-accounts')?.body,
      ).toMatchObject({
        type: 'BANK',
        name: 'Meezan',
        bankName: 'Meezan Bank',
        accountNumber: 'PK11',
        showToCustomers: true,
      }),
    );
  });
});
