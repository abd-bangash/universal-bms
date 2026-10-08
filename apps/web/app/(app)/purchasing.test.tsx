import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, page, renderWithProviders } from '@/test/render';
import { PurchaseDetail } from './purchasing/purchase-detail';
import { PurchaseForm } from './purchasing/purchase-form';
import { PurchaseList } from './purchasing/purchase-list';
import { SupplierDetail } from './purchasing/suppliers/supplier-detail';
import { SupplierList } from './purchasing/suppliers/supplier-list';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/purchasing/orders',
}));

const supplier = {
  id: 's1',
  name: 'Timber Co',
  contactName: 'Tariq',
  phone: '0300-1',
  email: null,
  address: null,
  notes: null,
  status: 'ACTIVE',
  customFields: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  summary: {
    totalOrdered: '500',
    totalReceived: '360',
    totalReturned: '0',
    totalPaid: '100',
    balance: '260',
  },
};
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
      key: 'sent',
      label: 'Sent',
      color: '#3b82f6',
      category: 'IN_PROGRESS',
      systemRole: 'SENT',
      active: true,
    },
    {
      key: 'partially_received',
      label: 'Partially received',
      color: '#f59e0b',
      category: 'IN_PROGRESS',
      systemRole: 'PARTIALLY_RECEIVED',
      active: true,
    },
    {
      key: 'received',
      label: 'Received',
      color: '#16a34a',
      category: 'DONE',
      systemRole: 'RECEIVED',
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
const item = {
  id: 'i1',
  lineNo: 1,
  variantId: 'v1',
  sku: 'CH-A',
  name: 'Chair',
  quantity: '10',
  unitCost: '60',
  receivedQty: '4',
  returnedQty: '0',
  lineTotal: '600',
};
const purchase = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  orderNumber: 'PO-2026-0001',
  supplierId: 's1',
  supplierName: 'Timber Co',
  locationId: 'l1',
  status: 'sent',
  orderDate: '2026-01-05T00:00:00.000Z',
  expectedDate: null,
  subtotal: '600',
  taxAmount: '0',
  totalAmount: '600',
  notes: null,
  version: 3,
  items: [item],
  receipts: [
    {
      id: 'g1',
      receiptNumber: 'GRN-2026-0001',
      receivedAt: '2026-01-06T10:00:00.000Z',
      note: null,
      lines: [{}],
    },
  ],
  allowedTransitions: [{ to: 'cancelled' }],
  ...over,
});
const variants = [
  {
    variantId: 'v1',
    productName: 'Chair',
    variantName: null,
    sku: 'CH-A',
    price: '100',
    availableStock: '6',
  },
];
const base = {
  'GET /workflows/PURCHASE_ORDER': () => states,
  'GET /suppliers': () => page([supplier]),
  'GET /inventory/locations': () => [
    { id: 'l1', name: 'Main store', type: 'STORE', isDefault: true, active: true },
  ],
  'GET /catalog/variants/search': () => variants,
};
const buyer = {
  permissions: [
    'supplier:view',
    'supplier:create',
    'supplier:edit',
    'supplier:archive',
    'purchase:view',
    'purchase:create',
    'purchase:edit',
    'purchase:receive',
    'product:view',
  ],
};

beforeEach(() => push.mockClear());

describe('SupplierList and detail', () => {
  it('lists suppliers and adds one through the dialog', async () => {
    const { calls } = mockApi({
      ...base,
      'POST /suppliers': () => ({ ...supplier, id: 's2', name: 'New Supplier' }),
    });
    renderWithProviders(<SupplierList />, { session: buyer });
    expect(await screen.findByText('Timber Co')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /New supplier/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText("Enter the supplier's name.")).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'New Supplier');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '0301-5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/suppliers')?.body).toMatchObject(
        {
          name: 'New Supplier',
          phone: '0301-5',
        },
      ),
    );
  });

  it('hides the add button without permission', async () => {
    mockApi(base);
    renderWithProviders(<SupplierList />, { session: { permissions: ['supplier:view'] } });
    expect(await screen.findByText('Timber Co')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New supplier/i })).not.toBeInTheDocument();
  });

  it('shows what is owed and the purchase history', async () => {
    mockApi({
      ...base,
      'GET /suppliers/s1': () => supplier,
      'GET /suppliers/s1/purchases': () => [
        {
          id: 'p1',
          orderNumber: 'PO-1',
          status: 'sent',
          orderDate: '2026-01-05T00:00:00.000Z',
          totalAmount: '600',
        },
      ],
    });
    renderWithProviders(<SupplierDetail supplierId="s1" />, { session: buyer });
    expect(await screen.findByRole('heading', { name: 'Timber Co' })).toBeInTheDocument();
    expect(screen.getByText('Balance owed').nextSibling).toHaveTextContent('260');
    expect(await screen.findByRole('link', { name: 'PO-1' })).toHaveAttribute(
      'href',
      '/purchasing/orders/p1',
    );
  });

  it('archives a supplier', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /suppliers/s1': () => supplier,
      'GET /suppliers/s1/purchases': () => [],
      'POST /suppliers/s1/archive': () => ({ ...supplier, status: 'ARCHIVED' }),
    });
    renderWithProviders(<SupplierDetail supplierId="s1" />, { session: buyer });
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/suppliers/s1/archive')).toBe(true));
  });
});

describe('PurchaseList', () => {
  it('shows orders with their workflow status and links to the quick purchase', async () => {
    mockApi({
      ...base,
      'GET /purchases': () => page([purchase()]),
    });
    renderWithProviders(<PurchaseList />, { session: buyer });
    expect(await screen.findByText('PO-2026-0001')).toBeInTheDocument();
    expect(screen.getAllByText('Sent').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Quick purchase' })).toHaveAttribute(
      'href',
      '/purchasing/quick',
    );
  });
});

describe('PurchaseForm', () => {
  async function fill() {
    await screen.findByRole('option', { name: 'Timber Co' });
    await userEvent.selectOptions(screen.getByLabelText(/^Supplier/), 's1');
    await userEvent.type(screen.getByLabelText('Add a product'), 'chair');
    await userEvent.click(await screen.findByRole('button', { name: /Chair/ }));
    await userEvent.clear(screen.getByLabelText('Quantity'));
    await userEvent.type(screen.getByLabelText('Quantity'), '8');
    await userEvent.type(screen.getByLabelText('Unit cost'), '45');
  }

  it('creates a purchase order from the lines and shows an estimated total', async () => {
    const { calls } = mockApi({ ...base, 'POST /purchases': () => purchase({ id: 'p9' }) });
    renderWithProviders(<PurchaseForm mode="create" />, { session: buyer });
    await fill();
    expect(screen.getByText(/Estimated total/)).toHaveTextContent('360');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/purchasing/orders/p9'));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/purchases')?.body).toMatchObject({
      supplierId: 's1',
      lines: [{ variantId: 'v1', quantity: '8', unitCost: '45.00' }],
    });
  });

  it('needs a supplier and at least one line', async () => {
    mockApi(base);
    renderWithProviders(<PurchaseForm mode="create" />, { session: buyer });
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose a supplier.')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Timber Co' });
    await userEvent.selectOptions(screen.getByLabelText(/^Supplier/), 's1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Add at least one product.')).toBeInTheDocument();
  });

  it('a quick purchase is sent with an idempotency key and opens the received order', async () => {
    const { fetchMock } = mockApi({
      ...base,
      'POST /purchases/quick': () => ({ purchase: purchase({ id: 'p7', status: 'received' }) }),
    });
    renderWithProviders(<PurchaseForm mode="quick" />, { session: buyer });
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Save and receive' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/purchasing/orders/p7'));
    const sent = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/purchases/quick'));
    expect((sent?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': expect.any(String),
    });
  });
});

describe('PurchaseDetail', () => {
  it('shows lines with what has arrived, the receipts and only the allowed moves', async () => {
    mockApi({ ...base, 'GET /purchases/p1': () => purchase() });
    renderWithProviders(<PurchaseDetail purchaseId="p1" />, { session: buyer });
    expect(await screen.findByRole('heading', { name: 'PO-2026-0001' })).toBeInTheDocument();
    const row = screen.getByText('Chair').closest('tr') as HTMLElement;
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/GRN-2026-0001/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Received' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Purchase order PDF' })).toHaveAttribute(
      'href',
      '/api/bff/purchases/p1/pdf',
    );
  });

  it('receives the remaining quantity with one idempotent request', async () => {
    const { calls, fetchMock } = mockApi({
      ...base,
      'GET /purchases/p1': () => purchase(),
      'POST /purchases/p1/receive': () => ({ purchase: purchase({ status: 'received' }) }),
    });
    renderWithProviders(<PurchaseDetail purchaseId="p1" />, { session: buyer });
    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Quantity received for CH-A')).toHaveValue('6');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Receive' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/purchases/p1/receive')?.body).toEqual({
        lines: [{ itemId: 'i1', quantity: '6' }],
      }),
    );
    const sent = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/receive'));
    expect((sent?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': expect.any(String),
    });
  });

  it('refuses to send more than was ordered unless the person may approve', async () => {
    mockApi({ ...base, 'GET /purchases/p1': () => purchase() });
    renderWithProviders(<PurchaseDetail purchaseId="p1" />, { session: buyer });
    await userEvent.click(await screen.findByRole('button', { name: 'Receive goods' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Quantity received for CH-A');
    await userEvent.clear(input);
    await userEvent.type(input, '9');
    expect(within(dialog).getByRole('button', { name: 'Receive' })).toBeDisabled();
    expect(within(dialog).getByText(/cannot receive more than was ordered/)).toBeInTheDocument();
  });

  it('hides receiving from people without the permission and when nothing is open', async () => {
    mockApi({ ...base, 'GET /purchases/p1': () => purchase() });
    const { unmount } = renderWithProviders(<PurchaseDetail purchaseId="p1" />, {
      session: { permissions: ['purchase:view', 'purchase:edit'] },
    });
    await screen.findByRole('heading', { name: 'PO-2026-0001' });
    expect(screen.queryByRole('button', { name: 'Receive goods' })).not.toBeInTheDocument();
    unmount();
    mockApi({
      ...base,
      'GET /purchases/p1': () => purchase({ status: 'received', allowedTransitions: [] }),
    });
    renderWithProviders(<PurchaseDetail purchaseId="p1" />, { session: buyer });
    await screen.findByRole('heading', { name: 'PO-2026-0001' });
    expect(screen.queryByRole('button', { name: 'Receive goods' })).not.toBeInTheDocument();
  });

  it('moves a draft to Sent with the status button', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /purchases/p1': () =>
        purchase({ status: 'draft', allowedTransitions: [{ to: 'sent' }, { to: 'cancelled' }] }),
      'POST /purchases/p1/status': () => ({ purchase: purchase(), pendingApproval: false }),
    });
    renderWithProviders(<PurchaseDetail purchaseId="p1" />, { session: buyer });
    await userEvent.click(await screen.findByRole('button', { name: 'Sent' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/purchases/p1/status')?.body).toEqual({
        status: 'sent',
      }),
    );
  });
});
