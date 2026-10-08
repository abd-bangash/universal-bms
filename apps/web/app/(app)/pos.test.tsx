import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { failure, mockApi, page, renderWithProviders } from '@/test/render';
import { PosScreen } from './pos/pos-screen';
import { ReceiptHistory } from './pos/receipts/receipt-history';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/pos',
}));

const chair = {
  variantId: 'v1',
  productName: 'Chair',
  variantName: null,
  sku: 'CH-A',
  price: '100',
  availableStock: '6',
};
const totals = (total: string) => ({
  subtotal: total,
  discountAmount: '0',
  taxAmount: '0',
  roundingAmount: '0',
  total,
  lines: [],
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
const checkoutResult = {
  order: { id: 'o1', orderNumber: 'ORD-1' },
  receipt: { id: 'r1', receiptNumber: 'RCP-00001' },
  tendered: '500',
  changeDue: '300',
  session: { id: 's1' },
};
const cashier = { permissions: ['pos:sell', 'pos:reprint', 'product:view', 'customer:view'] };

function routes(extra: Record<string, () => unknown> = {}) {
  return {
    'GET /catalog/variants/lookup': () => chair,
    'GET /catalog/variants/search': () => [chair],
    'GET /settings/payment-methods': () => methods,
    'POST /pricing/preview': () => totals('100'),
    'GET /documents/receipts/r1/pdf': () => new Response('%PDF', { status: 200 }),
    ...extra,
  };
}

beforeEach(() => {
  window.open = jest.fn(() => ({}) as Window);
  URL.createObjectURL = jest.fn(() => 'blob:receipt');
  URL.revokeObjectURL = jest.fn();
});

async function addChair() {
  const search = screen.getByLabelText(/^Product/);
  await userEvent.type(search, 'CH-A{Enter}');
  expect(await screen.findByText('Chair')).toBeInTheDocument();
}

describe('PosScreen', () => {
  it('adds a scanned code on Enter, raises the quantity on a second scan, and shows server totals', async () => {
    const { calls } = mockApi(routes());
    renderWithProviders(<PosScreen />, { session: cashier });
    await addChair();
    expect(calls.find((c) => c.path === '/catalog/variants/lookup')?.query.get('code')).toBe(
      'CH-A',
    );
    await userEvent.type(screen.getByLabelText(/^Product/), 'CH-A{Enter}');
    await waitFor(() => expect(screen.getByLabelText('Qty')).toHaveValue('2'));
    expect(await screen.findAllByText(/100\.00/)).not.toHaveLength(0);
  });

  it('falls back to the first search result when the text is not an exact code', async () => {
    mockApi(
      routes({
        'GET /catalog/variants/lookup': () => failure(404, 'NOT_FOUND') as unknown as never,
      }),
    );
    renderWithProviders(<PosScreen />, { session: cashier });
    await userEvent.type(screen.getByLabelText(/^Product/), 'chai{Enter}');
    expect(await screen.findByText('CH-A')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    mockApi(
      routes({
        'GET /catalog/variants/lookup': () => failure(404, 'NOT_FOUND') as unknown as never,
        'GET /catalog/variants/search': () => [],
      }),
    );
    renderWithProviders(<PosScreen />, { session: cashier });
    await userEvent.type(screen.getByLabelText(/^Product/), 'zzz{Enter}');
    expect(await screen.findByText('No product matches.')).toBeInTheDocument();
  });

  it('takes a cash payment, shows the change, sends one idempotent checkout and opens the receipt', async () => {
    const { calls, fetchMock } = mockApi(routes({ 'POST /pos/checkout': () => checkoutResult }));
    renderWithProviders(<PosScreen />, { session: cashier });
    await addChair();
    await userEvent.click(screen.getByRole('button', { name: /^Pay/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Payment method/), 'm-cash');
    await userEvent.type(within(dialog).getByLabelText('Amount handed over'), '500');
    expect(within(dialog).getByText(/Change/)).toHaveTextContent('400');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findByText(/Sale ORD-1 complete/)).toBeInTheDocument();
    const checkout = calls.find((c) => c.path === '/pos/checkout');
    expect(checkout?.body).toMatchObject({
      lines: [{ variantId: 'v1', quantity: '1' }],
      payment: { paymentMethodId: 'm-cash', tendered: '500.00' },
    });
    const sent = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/pos/checkout'));
    expect((sent?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': expect.any(String),
    });
    expect(window.open).toHaveBeenCalledWith('blob:receipt', '_blank');
    await userEvent.click(screen.getByRole('button', { name: 'New sale' }));
    expect(screen.getByText(/The cart is empty/)).toBeInTheDocument();
  });

  it('blocks completing a cash sale when the tender is below the total', async () => {
    mockApi(routes());
    renderWithProviders(<PosScreen />, { session: cashier });
    await addChair();
    await userEvent.click(screen.getByRole('button', { name: /^Pay/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Payment method/), 'm-cash');
    await userEvent.type(within(dialog).getByLabelText('Amount handed over'), '50');
    expect(within(dialog).getByText('The amount is less than the total.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Complete sale' })).toBeDisabled();
  });

  it('needs a reference for a method that asks for one', async () => {
    mockApi(routes());
    renderWithProviders(<PosScreen />, { session: cashier });
    await addChair();
    await userEvent.click(screen.getByRole('button', { name: /^Pay/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Payment method/), 'm-bank');
    expect(within(dialog).getByRole('button', { name: 'Complete sale' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reference number/), 'TX-9');
    expect(within(dialog).getByRole('button', { name: 'Complete sale' })).toBeEnabled();
  });

  it('keeps the cart and retries with the same idempotency key when the server cannot be reached', async () => {
    let attempts = 0;
    const { fetchMock } = mockApi(
      routes({
        'POST /pos/checkout': () => {
          attempts += 1;
          if (attempts === 1) throw new TypeError('Failed to fetch');
          return checkoutResult;
        },
      }),
    );
    renderWithProviders(<PosScreen />, { session: cashier });
    await addChair();
    await userEvent.click(screen.getByRole('button', { name: /^Pay/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Payment method/), 'm-cash');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete sale' }));
    expect(await within(dialog).findByText('The server cannot be reached')).toBeInTheDocument();
    expect(screen.getByText('Chair')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Sale ORD-1 complete/)).toBeInTheDocument();
    const keys = fetchMock.mock.calls
      .filter((c) => String(c[0]).endsWith('/pos/checkout'))
      .map((c) => ((c[1] as RequestInit).headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('shows the API refusal in the dialog and keeps the cart (insufficient stock)', async () => {
    mockApi(
      routes({
        'POST /pos/checkout': () => failure(409, 'INSUFFICIENT_STOCK') as unknown as never,
      }),
    );
    renderWithProviders(<PosScreen />, { session: cashier });
    await addChair();
    await userEvent.click(screen.getByRole('button', { name: /^Pay/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Payment method/), 'm-cash');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete sale' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Chair')).toBeInTheDocument();
  });

  it('still reports a sale as complete when the receipt cannot be opened', async () => {
    mockApi(
      routes({
        'POST /pos/checkout': () => checkoutResult,
        'GET /documents/receipts/r1/pdf': () => failure(500, 'INTERNAL_ERROR') as unknown as never,
      }),
    );
    renderWithProviders(<PosScreen />, { session: cashier });
    await addChair();
    await userEvent.click(screen.getByRole('button', { name: /^Pay/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Payment method/), 'm-cash');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findByText(/Sale ORD-1 complete/)).toBeInTheDocument();
    expect(screen.getByText(/receipt could not be opened/)).toBeInTheDocument();
  });

  it('F4 opens payment and the salesperson picker needs permission to list staff', async () => {
    mockApi(
      routes({
        'GET /users': () => page([{ id: 'u2', firstName: 'Sam', lastName: 'Sales' }]) as never,
      }),
    );
    const { unmount } = renderWithProviders(<PosScreen />, { session: cashier });
    expect(screen.queryByLabelText('Salesperson')).not.toBeInTheDocument();
    await addChair();
    await userEvent.keyboard('{F4}');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    unmount();
    renderWithProviders(<PosScreen />, {
      session: { permissions: [...cashier.permissions, 'user:view'] },
    });
    expect(await screen.findByLabelText('Salesperson')).toBeInTheDocument();
  });
});

describe('ReceiptHistory', () => {
  const row = {
    id: 'r1',
    receiptNumber: 'RCP-00001',
    orderId: 'o1',
    orderNumber: 'ORD-1',
    customerName: null,
    type: 'SALE',
    issuedAt: '2026-01-05T10:00:00.000Z',
    totalAmount: '200',
    reprintCount: 1,
  };

  it('lists receipts and reprints: counts the reprint, then opens the PDF', async () => {
    const { calls } = mockApi({
      'GET /pos/receipts': () => page([row]) as never,
      'POST /pos/receipts/r1/reprint': () => ({ ...row, reprintCount: 2 }),
      'GET /documents/receipts/r1/pdf': () => new Response('%PDF', { status: 200 }),
    });
    renderWithProviders(<ReceiptHistory />, { session: cashier });
    expect(await screen.findByText('RCP-00001')).toBeInTheDocument();
    expect(screen.getByText('Walk-in')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reprint receipt RCP-00001' }));
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    const order = calls.map((c) => `${c.method} ${c.path}`);
    expect(order.indexOf('POST /pos/receipts/r1/reprint')).toBeLessThan(
      order.indexOf('GET /documents/receipts/r1/pdf'),
    );
  });

  it('hides reprint from people without the permission', async () => {
    mockApi({ 'GET /pos/receipts': () => page([row]) as never });
    renderWithProviders(<ReceiptHistory />, { session: { permissions: ['pos:sell'] } });
    expect(await screen.findByText('RCP-00001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reprint/ })).not.toBeInTheDocument();
  });
});
