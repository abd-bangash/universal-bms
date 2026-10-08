import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, page, renderWithProviders } from '@/test/render';
import HomePage from './page';
import { ReportCatalogue } from './reports/report-catalogue';
import { ReportView } from './reports/report-view';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/reports',
}));

const catalogue = [
  {
    key: 'sales-by-date',
    title: 'Sales by date',
    description: 'Orders by day.',
    financial: true,
    filters: [
      { key: 'range', label: 'Dates' },
      { key: 'salespersonId', label: 'Salesperson' },
    ],
    columns: [],
  },
  {
    key: 'stock-movements',
    title: 'Stock movements',
    description: 'The ledger.',
    financial: false,
    filters: [
      { key: 'range', label: 'Dates' },
      { key: 'locationId', label: 'Location' },
      { key: 'status', label: 'Type' },
    ],
    columns: [],
  },
];
const salesReport = {
  key: 'sales-by-date',
  title: 'Sales by date',
  range: { from: '2026-03-01', to: '2026-03-31' },
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'orders', label: 'Orders', type: 'number', total: true },
    { key: 'total', label: 'Total', type: 'money', financial: true, total: true },
  ],
  rows: [
    { key: '2026-03-10', date: '2026-03-10', orders: 2, total: '300.00' },
    { key: '2026-03-11', date: '2026-03-11', orders: 1, total: '200.00' },
  ],
  totals: { orders: '3', total: '500.00' },
  truncated: false,
};
const viewer = { permissions: ['report:view', 'report:export', 'user:view'] };

describe('ReportCatalogue', () => {
  it('lists the reports the person may run, each linking to its page', async () => {
    mockApi({ 'GET /reports': () => catalogue });
    renderWithProviders(<ReportCatalogue />, { session: viewer });
    expect(await screen.findByRole('link', { name: 'Sales by date' })).toHaveAttribute(
      'href',
      '/reports/sales-by-date',
    );
    expect(screen.getByText('The ledger.')).toBeInTheDocument();
  });

  it('says so when nothing is available', async () => {
    mockApi({ 'GET /reports': () => [] });
    renderWithProviders(<ReportCatalogue />, { session: viewer });
    expect(await screen.findByText('No reports are available to you.')).toBeInTheDocument();
  });
});

describe('ReportView', () => {
  const routes = {
    'GET /reports': () => catalogue,
    'GET /reports/sales-by-date': () => salesReport,
    'GET /staff': () => [],
    'GET /users': () => page([{ id: 'u2', firstName: 'Sam', lastName: 'Sales' }]),
    'GET /catalog/categories': () => [],
    'GET /inventory/locations': () => [],
  };

  it('shows rows with money in the workspace format and a totals line', async () => {
    mockApi(routes);
    renderWithProviders(<ReportView reportKey="sales-by-date" />, { session: viewer });
    expect(await screen.findByText('10/03/2026')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Sales by date' });
    const total = within(table).getAllByRole('row').at(-1) as HTMLElement;
    expect(within(total).getByText('Total')).toBeInTheDocument();
    expect(within(total).getByText('3')).toBeInTheDocument();
    expect(total).toHaveTextContent('500.00');
  });

  it('sends the chosen period and salesperson as filters', async () => {
    const { calls } = mockApi(routes);
    renderWithProviders(<ReportView reportKey="sales-by-date" />, { session: viewer });
    await screen.findByText('10/03/2026');
    expect(calls.find((c) => c.path === '/reports/sales-by-date')?.query.get('range')).toBe(
      'month',
    );
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'week');
    await waitFor(() => expect(calls.at(-1)?.query.get('range')).toBe('week'));
    await userEvent.selectOptions(screen.getByLabelText('Period'), 'custom');
    await userEvent.type(screen.getByLabelText('From'), '2026-03-01');
    await waitFor(() => expect(calls.at(-1)?.query.get('from')).toBe('2026-03-01'));
    expect(calls.at(-1)?.query.get('range')).toBeNull();
    await userEvent.selectOptions(await screen.findByLabelText('Salesperson'), 'u2');
    await waitFor(() => expect(calls.at(-1)?.query.get('salespersonId')).toBe('u2'));
  });

  it('opens the records behind a row, and behind the whole total', async () => {
    const { calls } = mockApi({
      ...routes,
      'GET /reports/sales-by-date/drilldown': () => ({
        columns: [
          { key: 'orderNumber', label: 'Order', type: 'text', link: 'order:orderId' },
          { key: 'total', label: 'Total', type: 'money', financial: true, total: true },
        ],
        rows: [
          { key: 'o1', orderId: 'o1', orderNumber: 'ORD-1', total: '100.10' },
          { key: 'o2', orderId: 'o2', orderNumber: 'ORD-2', total: '199.90' },
        ],
        truncated: false,
      }),
    });
    renderWithProviders(<ReportView reportKey="sales-by-date" />, { session: viewer });
    await userEvent.click(await screen.findByRole('button', { name: 'Records for 2026-03-10' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('link', { name: 'ORD-1' })).toHaveAttribute(
      'href',
      '/orders/o1',
    );
    expect(calls.find((c) => c.path.endsWith('/drilldown'))?.query.get('row')).toBe('2026-03-10');
    expect(dialog).toHaveTextContent('300.00'); // 100.10 + 199.90, added exactly
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'All records' }));
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/drilldown'))).toHaveLength(2));
    expect(
      calls
        .filter((c) => c.path.endsWith('/drilldown'))
        .at(-1)
        ?.query.get('row'),
    ).toBeNull();
  });

  it('exports the report as a file with the same filters', async () => {
    global.URL.createObjectURL = jest.fn(() => 'blob:csv');
    global.URL.revokeObjectURL = jest.fn();
    const clicked = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { calls, fetchMock } = mockApi({
      ...routes,
      'POST /reports/sales-by-date/export': () =>
        new Response('Date,Orders\r\n', { status: 200 }) as never,
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/export')) {
        calls.push({
          method: 'POST',
          path: '/reports/sales-by-date/export',
          query: new URL(url, 'http://x').searchParams,
          body: JSON.parse(String(init?.body)),
        });
        return new Response('Date,Orders\r\n', {
          status: 200,
          headers: {
            'content-disposition': 'attachment; filename="sales-by-date_2026-03-01_2026-03-31.csv"',
          },
        });
      }
      const handler =
        routes[
          `GET ${new URL(url, 'http://x').pathname.replace('/api/bff', '')}` as keyof typeof routes
        ];
      return new Response(JSON.stringify({ data: handler ? handler() : [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    renderWithProviders(<ReportView reportKey="sales-by-date" />, { session: viewer });
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ range: 'month' });
    clicked.mockRestore();
  });

  it('hides the export button from people who may not export', async () => {
    mockApi(routes);
    renderWithProviders(<ReportView reportKey="sales-by-date" />, {
      session: { permissions: ['report:view'] },
    });
    await screen.findByText('10/03/2026');
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });

  it('says so for a report that is not in the catalogue, and tells the person when rows were cut', async () => {
    mockApi({ ...routes, 'GET /reports': () => [catalogue[1]] });
    const { unmount } = renderWithProviders(<ReportView reportKey="sales-by-date" />, {
      session: viewer,
    });
    expect(await screen.findByText('This report is not available to you.')).toBeInTheDocument();
    unmount();
    mockApi({
      ...routes,
      'GET /reports/sales-by-date': () => ({ ...salesReport, truncated: true }),
    });
    renderWithProviders(<ReportView reportKey="sales-by-date" />, { session: viewer });
    expect(await screen.findByText(/Only the first rows are shown/)).toBeInTheDocument();
  });
});

describe('Home', () => {
  const dashboard = {
    generatedAt: '2026-03-10T10:00:00.000Z',
    timezone: 'UTC',
    salesToday: { orders: 2, total: '300.00' },
    salesWeek: { orders: 5, total: '900.00' },
    salesMonth: { orders: 9, total: '2500.00' },
    openOrders: [
      { status: 'confirmed', label: 'Confirmed', count: 4 },
      { status: 'ready', label: 'Ready', count: 1 },
    ],
    leadFunnel: [{ stage: 'new', label: 'New', count: 6 }],
    lowStock: { count: 3 },
    outstandingBalances: { customers: 2, total: '1200.00' },
    pendingCommissions: { count: 2, amount: '80.00' },
    myTasks: {
      overdue: 1,
      today: 2,
      items: [{ id: 't1', title: 'Call Sana', dueAt: '2026-03-09T10:00:00.000Z' }],
    },
  };

  it('shows every indicator the server sent, with alerts for stock and overdue tasks', async () => {
    mockApi({ 'GET /reports/dashboard': () => dashboard });
    renderWithProviders(<HomePage />, { session: viewer });
    expect(await screen.findByText('Sales today')).toBeInTheDocument();
    expect(screen.getByText('Sales this month').closest('div')).toHaveTextContent('2,500.00');
    expect(screen.getByRole('link', { name: 'Confirmed' })).toHaveAttribute(
      'href',
      '/orders?status=confirmed',
    );
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Call Sana')).toBeInTheDocument();
    const alerts = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(alerts).getByRole('link', { name: '3 items are low on stock' })).toHaveAttribute(
      'href',
      '/reports/low-stock',
    );
    expect(within(alerts).getByText('You have 1 overdue task')).toBeInTheDocument();
  });

  it('shows only what the server allowed: no money cards when none came', async () => {
    mockApi({
      'GET /reports/dashboard': () => ({
        generatedAt: dashboard.generatedAt,
        timezone: 'UTC',
        openOrders: dashboard.openOrders,
        pendingCommissions: { count: 2 },
      }),
    });
    renderWithProviders(<HomePage />, { session: { permissions: [] } });
    expect(await screen.findByText('Confirmed')).toBeInTheDocument();
    expect(screen.queryByText('Sales today')).not.toBeInTheDocument();
    expect(screen.queryByText('Owed by customers')).not.toBeInTheDocument();
    expect(screen.getByText('Commissions waiting').closest('div')).toHaveTextContent('2');
  });
});
