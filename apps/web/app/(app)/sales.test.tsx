import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { failure, mockApi, page, renderWithProviders } from '@/test/render';
import type { LineView, OrderView, QuotationView } from '@/lib/hooks/use-sales';
import { OrderDetail } from './orders/order-detail';
import { OrderForm } from './orders/order-form';
import { OrderList } from './orders/order-list';
import { QuotationDetail } from './quotations/quotation-detail';
import { QuotationForm } from './quotations/quotation-form';
import { QuotationList } from './quotations/quotation-list';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/orders',
}));

const line = (over: Partial<LineView> = {}): LineView => ({
  id: 'ln1',
  lineNo: 1,
  kind: 'CATALOG',
  productId: 'p1',
  variantId: 'v1',
  name: 'Corner Sofa',
  sku: 'SOFA-A',
  description: null,
  quantity: '2',
  listPrice: '1000',
  unitPrice: '1000',
  discountType: null,
  discountValue: '0',
  discountAmount: '0',
  taxRate: '0',
  taxAmount: '0',
  lineTotal: '2000',
  customFields: {},
  fieldSnapshot: [{ key: 'colour', label: 'Colour', value: 'Grey', unit: null }],
  ...over,
});

const quotation = (over: Partial<QuotationView> = {}): QuotationView => ({
  id: 'q1',
  quotationNumber: 'QT-2026-0001',
  customerId: 'c1',
  leadId: null,
  status: 'DRAFT',
  validUntil: '2026-12-31T00:00:00.000Z',
  subtotal: '2000',
  discountType: null,
  discountValue: '0',
  discountAmount: '0',
  taxAmount: '0',
  totalAmount: '2000',
  notes: null,
  terms: null,
  sentAt: null,
  acceptedAt: null,
  acceptedVia: null,
  rejectedReason: null,
  customFields: {},
  version: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
  items: [line()],
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
  status: 'draft',
  paymentStatus: 'UNPAID',
  orderDate: '2026-10-01T10:00:00.000Z',
  subtotal: '2000',
  discountType: null,
  discountValue: '0',
  discountAmount: '0',
  taxAmount: '0',
  totalAmount: '2000',
  depositRequired: '0',
  paidAmount: '0',
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
  items: [line()],
  allowedTransitions: [
    { to: 'confirmed', requiredPermission: null, requiredFields: [], requiresApproval: false },
    { to: 'on_hold', requiredPermission: null, requiredFields: [], requiresApproval: false },
    {
      to: 'cancelled',
      requiredPermission: 'order:cancel',
      requiredFields: [],
      requiresApproval: false,
    },
  ],
  ...over,
});

const states = {
  states: [
    {
      key: 'draft',
      label: 'Draft',
      color: '#64748b',
      category: 'OPEN',
      systemRole: 'DRAFT',
      active: true,
    },
    {
      key: 'confirmed',
      label: 'Confirmed',
      color: '#3b82f6',
      category: 'IN_PROGRESS',
      systemRole: 'CONFIRMED',
      active: true,
    },
    {
      key: 'on_hold',
      label: 'On hold',
      color: '#a3a3a3',
      category: 'IN_PROGRESS',
      systemRole: 'ON_HOLD',
      active: true,
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      color: '#dc2626',
      category: 'CANCELLED',
      systemRole: 'CANCELLED',
      active: true,
    },
  ],
};

const session = {
  permissions: [
    'quotation:view',
    'quotation:create',
    'quotation:edit',
    'quotation:send',
    'order:view',
    'order:create',
    'order:edit',
    'order:price_override',
    'customer:view',
    'product:view',
    'task:view',
    'task:create',
    'task:edit',
  ],
};

const base = {
  'GET /fields': () => [],
  'GET /settings/units': () => [],
  'GET /workflows/ORDER': () => states,
  'GET /customers/c1': () => ({ id: 'c1', fullName: 'Sana Malik' }),
  'GET /notes': () => [],
  'GET /tasks': () => page([]),
  'GET /orders/o1/timeline': () => page([]),
  'GET /orders/o1/status-history': () => [],
  'GET /orders/o1/invoices': () => [],
};

beforeEach(() => push.mockClear());

describe('QuotationList', () => {
  it('lists quotations with status and links, and filters by status', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /quotations': () =>
        page([
          quotation(),
          quotation({ id: 'q2', quotationNumber: 'QT-2026-0002', status: 'SENT' }),
        ]),
    });
    renderWithProviders(<QuotationList />, { session });
    expect(await screen.findByRole('link', { name: 'QT-2026-0001' })).toHaveAttribute(
      'href',
      '/quotations/q1',
    );
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(1);
    expect(screen.getByRole('link', { name: 'New quotation' })).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'ACCEPTED');
    await waitFor(() => expect(calls.at(-1)?.query.get('status')).toBe('ACCEPTED'));
  });
});

describe('QuotationDetail', () => {
  const open = (q: QuotationView) =>
    mockApi({
      ...base,
      'GET /quotations/q1': () => q,
      'POST /quotations/q1/send': () => ({ ...q, status: 'SENT' }),
      'POST /quotations/q1/reject': () => ({ ...q, status: 'REJECTED' }),
      'POST /quotations/q1/accept': () => ({ ...q, status: 'ACCEPTED' }),
      'POST /quotations/q1/convert': () => ({ order: order({ id: 'o9' }), quotation: q }),
    });

  it('shows lines with their field snapshot and offers send/edit/reject on a draft only', async () => {
    open(quotation());
    renderWithProviders(<QuotationDetail quotationId="q1" />, { session });
    expect(await screen.findByRole('heading', { name: 'QT-2026-0001' })).toBeInTheDocument();
    expect(screen.getByText('Colour: Grey')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute(
      'href',
      '/api/bff/quotations/q1/pdf',
    );
    expect(screen.getByRole('button', { name: 'Mark as sent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record acceptance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Convert to/ })).not.toBeInTheDocument();
  });

  it('sent: can record acceptance; accepted: can convert and goes to the new order', async () => {
    open(quotation({ status: 'SENT' }));
    const { unmount } = renderWithProviders(<QuotationDetail quotationId="q1" />, { session });
    expect(await screen.findByRole('button', { name: 'Record acceptance' })).toBeInTheDocument();
    unmount();

    const { calls } = open(
      quotation({
        status: 'ACCEPTED',
        acceptedAt: '2026-10-02T10:00:00.000Z',
        acceptedVia: 'PHONE',
      }),
    );
    renderWithProviders(<QuotationDetail quotationId="q1" />, { session });
    expect(await screen.findByText(/Accepted on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Convert to order' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/orders/o9'));
    expect(calls.some((c) => c.method === 'POST' && c.path === '/quotations/q1/convert')).toBe(
      true,
    );
  });

  it('rejecting needs a reason', async () => {
    const { calls } = open(quotation({ status: 'SENT' }));
    renderWithProviders(<QuotationDetail quotationId="q1" />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject this quotation', hidden: true });
    const confirm = within(dialog).getByRole('button', { name: 'Reject', hidden: true });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Too expensive');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/quotations/q1/reject')?.body).toEqual({
        reason: 'Too expensive',
      }),
    );
  });

  it('a person without quotation:send does not see the send button', async () => {
    open(quotation());
    renderWithProviders(<QuotationDetail quotationId="q1" />, {
      session: { permissions: ['quotation:view', 'quotation:edit'] },
    });
    await screen.findByRole('heading', { name: 'QT-2026-0001' });
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument();
  });
});

describe('line editor in QuotationForm', () => {
  it('adds a catalog line from the search, shows live totals, and creates the quotation', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /customers': () => [{ id: 'c1', fullName: 'Sana Malik', phones: ['0300'], email: null }],
      'GET /catalog/variants/search': () => [
        {
          variantId: 'v1',
          productName: 'Corner Sofa',
          variantName: null,
          sku: 'SOFA-A',
          price: '1000',
          availableStock: null,
        },
      ],
      'POST /pricing/preview': () => ({
        subtotal: '1000',
        discountAmount: '0',
        taxAmount: '0',
        roundingAmount: '0',
        total: '1000',
        lines: [],
      }),
      'POST /quotations': () => quotation({ id: 'qnew' }),
    });
    renderWithProviders(<QuotationForm quotation={null} />, { session });
    await userEvent.type(await screen.findByLabelText(/^Customer/), 'Sana');
    await userEvent.click(await screen.findByRole('button', { name: /Sana Malik/ }));
    await userEvent.type(screen.getByLabelText('Add a product'), 'sofa');
    await userEvent.click(await screen.findByRole('button', { name: /Corner Sofa/ }));
    expect(await screen.findByLabelText('Totals')).toHaveTextContent('1,000');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/quotations/qnew'));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/quotations')?.body).toMatchObject({
      customerId: 'c1',
      lines: [{ kind: 'CATALOG', variantId: 'v1', quantity: '1' }],
    });
  });

  it('asks for a customer before saving', async () => {
    mockApi({ ...base });
    renderWithProviders(<QuotationForm quotation={null} />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Choose a customer first.')).toBeInTheDocument();
  });

  it('a custom line takes a name and a price', async () => {
    mockApi({
      ...base,
      'POST /pricing/preview': () => ({
        subtotal: '0',
        discountAmount: '0',
        taxAmount: '0',
        roundingAmount: '0',
        total: '0',
        lines: [],
      }),
    });
    renderWithProviders(<QuotationForm quotation={null} />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Add a custom line' }));
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Unit price/)).toBeEnabled();
  });
});

describe('OrderList', () => {
  it('lists orders with the workspace status labels and filters by status and payment', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /orders': () =>
        page([
          order(),
          order({
            id: 'o2',
            orderNumber: 'ORD-2026-0002',
            status: 'confirmed',
            paymentStatus: 'DEPOSIT_PAID',
          }),
        ]),
    });
    renderWithProviders(<OrderList />, { session });
    expect(await screen.findByRole('link', { name: 'ORD-2026-0002' })).toHaveAttribute(
      'href',
      '/orders/o2',
    );
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    await userEvent.selectOptions(await screen.findByLabelText('Payment'), 'DEPOSIT_PAID');
    await waitFor(() => expect(calls.at(-1)?.query.get('paymentStatus')).toBe('DEPOSIT_PAID'));
  });
});

describe('OrderDetail', () => {
  const open = (o: OrderView, extra: Record<string, () => unknown | Response> = {}) =>
    mockApi({ ...base, 'GET /orders/o1': () => o, ...extra });

  it('offers only the allowed moves, moves the order, and shows the status history', async () => {
    const { calls } = open(order(), {
      'POST /orders/o1/status': () => ({
        order: order({ status: 'confirmed' }),
        pendingApproval: false,
      }),
    });
    renderWithProviders(<OrderDetail orderId="o1" />, { session });
    const section = (await screen.findByRole('heading', { name: 'Move to' })).closest(
      'section',
    ) as HTMLElement;
    expect(
      within(section)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Confirmed', 'On hold', 'Cancelled']);
    await userEvent.click(within(section).getByRole('button', { name: 'Confirmed' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/orders/o1/status')?.body).toEqual({
        status: 'confirmed',
      }),
    );
  });

  it('cancelling asks for a reason and sends it', async () => {
    const { calls } = open(order(), {
      'POST /orders/o1/status': () => ({
        order: order({ status: 'cancelled' }),
        pendingApproval: false,
      }),
    });
    renderWithProviders(<OrderDetail orderId="o1" />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelled' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this order', hidden: true });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel the order', hidden: true });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Changed mind');
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/orders/o1/status')?.body).toEqual({
        status: 'cancelled',
        reason: 'Changed mind',
      }),
    );
  });

  it('shows why a move was refused', async () => {
    open(order({ status: 'confirmed' }), {
      'POST /orders/o1/status': () => failure(422, 'DEPOSIT_REQUIRED'),
    });
    renderWithProviders(<OrderDetail orderId="o1" />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmed' }));
    expect(await screen.findByText(/required deposit has not been paid/)).toBeInTheDocument();
  });

  it('hides the status controls from people who cannot edit, and for closed orders', async () => {
    open(order());
    const { unmount } = renderWithProviders(<OrderDetail orderId="o1" />, {
      session: { permissions: ['order:view', 'customer:view'] },
    });
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });
    expect(screen.queryByRole('heading', { name: 'Move to' })).not.toBeInTheDocument();
    unmount();

    open(order({ status: 'cancelled', cancelReason: 'Changed mind', allowedTransitions: [] }));
    renderWithProviders(<OrderDetail orderId="o1" />, { session });
    expect(await screen.findByText('Cancelled: Changed mind')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Move to' })).not.toBeInTheDocument();
  });

  it('lists documents and issues an invoice once the order is confirmed', async () => {
    const { calls } = open(order({ status: 'confirmed', allowedTransitions: [] }), {
      'POST /orders/o1/invoice': () => ({
        id: 'i1',
        invoiceNumber: 'INV-2026-0001',
        issuedAt: '2026-10-03T10:00:00.000Z',
        totalAmount: '2000',
      }),
    });
    renderWithProviders(<OrderDetail orderId="o1" />, { session });
    expect(await screen.findByRole('link', { name: 'Order confirmation (PDF)' })).toHaveAttribute(
      'href',
      '/api/bff/orders/o1/pdf',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Issue an invoice' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/orders/o1/invoice')).toBe(true),
    );
  });

  it('a draft order has no invoice button; saving fulfilment sends the fields', async () => {
    const { calls } = open(order(), { 'PATCH /orders/o1/fulfilment': () => order() });
    renderWithProviders(<OrderDetail orderId="o1" />, { session });
    await screen.findByRole('heading', { name: 'ORD-2026-0001' });
    expect(screen.queryByRole('button', { name: 'Issue an invoice' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'DELIVERY');
    await userEvent.type(screen.getByLabelText('Address'), '5 Mall Road');
    await userEvent.type(screen.getByLabelText('Received by'), 'Sana');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
        method: 'DELIVERY',
        deliveryAddress: { line1: '5 Mall Road' },
        receiverName: 'Sana',
      }),
    );
  });
});

describe('OrderForm', () => {
  it('sends an Idempotency-Key with a new order, the same one if sent again', async () => {
    let n = 0;
    const { fetchMock } = mockApi({
      ...base,
      'GET /customers': () => [{ id: 'c1', fullName: 'Sana Malik', phones: [], email: null }],
      'POST /orders': () => {
        n += 1;
        return n === 1 ? failure(500, 'INTERNAL_ERROR') : order({ id: 'onew' });
      },
    });
    renderWithProviders(<OrderForm order={null} />, { session });
    await userEvent.type(await screen.findByLabelText(/^Customer/), 'Sana');
    await userEvent.click(await screen.findByRole('button', { name: /Sana Malik/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/orders/onew'));
    const keys = fetchMock.mock.calls
      .filter(([url, init]) => String(url).endsWith('/orders') && init?.method === 'POST')
      .map(([, init]) => (init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });
});
