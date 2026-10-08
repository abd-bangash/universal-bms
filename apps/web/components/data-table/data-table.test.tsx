import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, mockFetch, renderWithProviders } from '@/test/render';
import { DataTable, type Column } from './data-table';

interface Row {
  id: string;
  name: string;
}

const columns: Array<Column<Row>> = [
  { key: 'name', header: 'Name', cell: (r) => r.name, sortKey: 'name' },
  { key: 'id', header: 'Code', cell: (r) => r.id },
];

const table = (props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) => (
  <DataTable<Row>
    queryKey="things"
    endpoint="/things"
    columns={columns}
    rowKey={(r) => r.id}
    caption="Things"
    pageSize={2}
    {...props}
  />
);

const lastUrl = (fetchMock: jest.Mock) =>
  new URL(String((fetchMock.mock.calls.at(-1) as [string])[0]), 'http://x');

describe('DataTable (Requirement 49.4)', () => {
  it('shows a loading state, then the rows', async () => {
    mockFetch(() =>
      jsonResponse({
        data: [
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ],
        meta: {},
      }),
    );
    renderWithProviders(table());
    expect(screen.getByRole('status')).toHaveTextContent('Loading rows');
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Things' })).toBeInTheDocument();
  });

  it('shows an empty state with a message of the screen’s own', async () => {
    mockFetch(() => jsonResponse({ data: [], meta: {} }));
    renderWithProviders(
      table({ emptyTitle: 'No customers yet', emptyDescription: 'Add the first one.' }),
    );
    expect(await screen.findByText('No customers yet')).toBeInTheDocument();
    expect(screen.getByText('Add the first one.')).toBeInTheDocument();
  });

  it('shows an error state and retries on request', async () => {
    let fail = true;
    const fetchMock = mockFetch(() =>
      fail
        ? jsonResponse(
            { statusCode: 500, code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
            500,
          )
        : jsonResponse({ data: [{ id: 'a', name: 'Alpha' }], meta: {} }),
    );
    renderWithProviders(table());
    expect(await screen.findByText(/We could not load this list/)).toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('searches after a short pause and says so when nothing matches', async () => {
    const fetchMock = mockFetch((url) =>
      jsonResponse({ data: url.includes('q=zzz') ? [] : [{ id: 'a', name: 'Alpha' }], meta: {} }),
    );
    renderWithProviders(table());
    await screen.findByText('Alpha');
    await userEvent.type(screen.getByLabelText('Search the list'), 'zzz');
    expect(await screen.findByText('No results')).toBeInTheDocument();
    expect(lastUrl(fetchMock).searchParams.get('q')).toBe('zzz');
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(lastUrl(fetchMock).searchParams.has('q')).toBe(false);
  });

  it('filters with the given options and sends them to the API', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({ data: [{ id: 'a', name: 'Alpha' }], meta: {} }),
    );
    renderWithProviders(
      table({
        filters: [
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ],
          },
        ],
      }),
    );
    await screen.findByText('Alpha');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'INACTIVE');
    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get('status')).toBe('INACTIVE'));
  });

  it('sorts by a column, toggling direction, and announces it', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({ data: [{ id: 'a', name: 'Alpha' }], meta: {} }),
    );
    renderWithProviders(table({ defaultSort: 'createdAt:desc' }));
    await screen.findByText('Alpha');
    expect(lastUrl(fetchMock).searchParams.get('sort')).toBe('createdAt:desc');
    const header = screen.getByRole('columnheader', { name: /Name/ });
    await userEvent.click(within(header).getByRole('button'));
    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get('sort')).toBe('name:asc'));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(within(header).getByRole('button'));
    await waitFor(() => expect(lastUrl(fetchMock).searchParams.get('sort')).toBe('name:desc'));
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  it('pages forward and back with the API’s cursors, and returns to page one when the search changes', async () => {
    const pages: Record<string, { data: Row[]; meta: { nextCursor?: string; total: number } }> = {
      '': {
        data: [
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ],
        meta: { nextCursor: 'c1', total: 3 },
      },
      c1: { data: [{ id: 'c', name: 'Gamma' }], meta: { total: 3 } },
    };
    const fetchMock = mockFetch((url) =>
      jsonResponse(pages[new URL(url, 'http://x').searchParams.get('cursor') ?? '']),
    );
    renderWithProviders(table());
    await screen.findByText('Alpha');
    expect(screen.getByText(/Page 1/)).toHaveTextContent('3 in total');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Gamma')).toBeInTheDocument();
    expect(lastUrl(fetchMock).searchParams.get('cursor')).toBe('c1');
    expect(lastUrl(fetchMock).searchParams.get('limit')).toBe('2');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Gamma');
    await userEvent.type(screen.getByLabelText('Search the list'), 'a');
    await waitFor(() => expect(screen.getByText(/Page 1/)).toBeInTheDocument());
  });

  it('passes fixed parameters and reports row clicks', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({ data: [{ id: 'a', name: 'Alpha' }], meta: {} }),
    );
    const onRowClick = jest.fn();
    renderWithProviders(table({ params: { tab: 'open' }, onRowClick }));
    await userEvent.click(await screen.findByText('Alpha'));
    expect(onRowClick).toHaveBeenCalledWith({ id: 'a', name: 'Alpha' });
    expect(lastUrl(fetchMock).searchParams.get('tab')).toBe('open');
  });

  it('can hide the search box', async () => {
    mockFetch(() => jsonResponse({ data: [], meta: {} }));
    renderWithProviders(table({ searchable: false }));
    await screen.findByText('Nothing here yet');
    expect(screen.queryByLabelText('Search the list')).not.toBeInTheDocument();
  });
});
