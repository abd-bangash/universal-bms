import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, page, renderWithProviders } from '@/test/render';
import HomePage from './page';
import { AdjustForm, OpeningStockForm } from './inventory/adjust/adjust-forms';
import { LocationManager } from './inventory/locations/location-manager';
import { MovementList } from './inventory/movements/movement-list';
import { StockTable } from './inventory/stock-table';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/inventory',
}));

const row = (over: Record<string, unknown> = {}) => ({
  variantId: 'v1',
  sku: 'CH-A',
  productName: 'Chair',
  variantName: null,
  onHand: '10',
  reserved: '4',
  available: '6',
  avgCost: '40',
  stockValue: '400',
  minStockLevel: '5',
  maxStockLevel: '50',
  low: false,
  overstock: false,
  ...over,
});
const locations = [
  { id: 'l1', name: 'Main store', type: 'STORE', isDefault: true, active: true },
  { id: 'l2', name: 'Warehouse', type: 'WAREHOUSE', isDefault: false, active: true },
];
const reasons = [{ id: 'r1', name: 'Damaged', active: true }];
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
  'GET /inventory/locations': () => locations,
  'GET /settings/adjustment-reasons': () => reasons,
  'GET /catalog/variants/search': () => variants,
};
const manager = { permissions: ['inventory:view', 'inventory:adjust', 'workspace:configure'] };

describe('StockTable', () => {
  it('shows on hand, reserved and available, flags low and overstock, and filters through the API', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /inventory/stock': () =>
        page([
          row({ low: true, available: '2', onHand: '6' }),
          row({
            variantId: 'v2',
            sku: 'CH-B',
            productName: 'Table',
            overstock: true,
            onHand: '90',
            available: '90',
            reserved: '0',
          }),
        ]),
    });
    renderWithProviders(<StockTable />, { session: manager });
    expect(await screen.findByText('CH-A')).toBeInTheDocument();
    expect(screen.getAllByText('Low').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Overstock').length).toBeGreaterThan(1); // the badge and the filter
    await userEvent.selectOptions(screen.getByLabelText('Low stock'), 'true');
    await waitFor(() => expect(calls.at(-1)?.query.get('low')).toBe('true'));
  });
});

describe('MovementList', () => {
  it('lists movements with the item, type and signed quantity', async () => {
    mockApi({
      ...base,
      'GET /inventory/movements': () =>
        page([
          {
            id: 'm1',
            variantId: 'v1',
            locationId: 'l1',
            movementType: 'SALE',
            sku: 'CH-A',
            productName: 'Chair',
            quantityDelta: '-3',
            unitCost: null,
            referenceType: 'ORDER',
            reasonId: null,
            note: null,
            createdAt: '2026-10-02T10:00:00.000Z',
          },
          {
            id: 'm2',
            variantId: 'v1',
            locationId: 'l1',
            movementType: 'OPENING_STOCK',
            sku: 'CH-A',
            productName: 'Chair',
            quantityDelta: '10',
            unitCost: '40',
            referenceType: 'OPENING',
            reasonId: null,
            note: 'Count',
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ]),
    });
    renderWithProviders(<MovementList />, { session: manager });
    expect(await screen.findByText('-3')).toBeInTheDocument();
    expect(screen.getByText('+10')).toBeInTheDocument();
    expect(screen.getAllByText('Sale').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Main store').length).toBeGreaterThan(0);
  });
});

describe('AdjustForm', () => {
  it('needs an item, a quantity and a reason, and sends an Idempotency-Key', async () => {
    const { calls, fetchMock } = mockApi({
      ...base,
      'POST /inventory/movements': () => ({ id: 'm1' }),
    });
    renderWithProviders(<AdjustForm />, { session: manager });
    const post = await screen.findByRole('button', { name: 'Post adjustment' });
    expect(post).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Item/), 'chair');
    await userEvent.click(await screen.findByRole('button', { name: /Chair/ }));
    await userEvent.type(screen.getByLabelText(/^Quantity/), '3');
    expect(post).toBeDisabled(); // no reason yet
    await screen.findByRole('option', { name: 'Damaged' });
    await userEvent.selectOptions(screen.getByLabelText(/^Reason/), 'r1');
    expect(post).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Note'), 'Scratched');
    await userEvent.click(post);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      variantId: 'v1',
      direction: 'OUT',
      quantity: '3',
      reasonId: 'r1',
      note: 'Scratched',
    });
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    expect(await screen.findByText('Adjustment posted.')).toBeInTheDocument();
  });

  it('asks for a unit cost only when putting stock in', async () => {
    mockApi({ ...base });
    renderWithProviders(<AdjustForm />, { session: manager });
    await screen.findByRole('button', { name: 'Post adjustment' });
    expect(screen.queryByLabelText('Unit cost')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'IN');
    expect(screen.getByLabelText('Unit cost')).toBeInTheDocument();
  });
});

describe('OpeningStockForm', () => {
  it('posts several items with their costs in one go', async () => {
    const { calls } = mockApi({ ...base, 'POST /inventory/opening-stock': () => [] });
    renderWithProviders(<OpeningStockForm />, { session: manager });
    await userEvent.type(await screen.findByLabelText(/^Item/), 'chair');
    await userEvent.click(await screen.findByRole('button', { name: /Chair/ }));
    const post = screen.getByRole('button', { name: 'Post opening stock' });
    expect(post).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Quantity/), '12');
    await userEvent.type(screen.getByLabelText(/^Unit cost/), '40');
    await userEvent.click(post);
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        lines: [{ variantId: 'v1', quantity: '12', unitCost: '40.00' }],
      }),
    );
  });
});

describe('LocationManager', () => {
  it('lists locations; only people who configure the workspace can change them', async () => {
    mockApi({ ...base });
    const { unmount } = renderWithProviders(<LocationManager />, {
      session: { permissions: ['inventory:view'] },
    });
    expect(await screen.findByText('Main store')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add location' })).not.toBeInTheDocument();
    unmount();
    renderWithProviders(<LocationManager />, { session: manager });
    expect(await screen.findByRole('button', { name: 'Add location' })).toBeInTheDocument();
  });

  it('adds a location', async () => {
    const { calls } = mockApi({ ...base, 'POST /inventory/locations': () => locations[1] });
    renderWithProviders(<LocationManager />, { session: manager });
    await userEvent.click(await screen.findByRole('button', { name: 'Add location' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a location', hidden: true });
    await userEvent.type(within(dialog).getByLabelText(/^Name/), 'Warehouse');
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'WAREHOUSE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save', hidden: true }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Warehouse',
        type: 'WAREHOUSE',
        isDefault: false,
      }),
    );
  });
});

describe('Home page', () => {
  it('shows how many items are low on stock to people who can see stock', async () => {
    mockApi({
      'GET /inventory/stock': () => page([row({ low: true }), row({ variantId: 'v2', low: true })]),
    });
    renderWithProviders(<HomePage />, { session: { permissions: ['inventory:view'] } });
    expect(await screen.findByRole('link', { name: '2 items are low on stock' })).toHaveAttribute(
      'href',
      '/inventory',
    );
  });

  it('shows nothing about stock to everyone else', async () => {
    const { calls } = mockApi({});
    renderWithProviders(<HomePage />, { session: { permissions: [] } });
    expect(screen.queryByText('Stock')).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
