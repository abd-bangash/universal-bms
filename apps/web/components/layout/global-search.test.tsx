import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderWithProviders } from '@/test/render';
import { GlobalSearch } from './global-search';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const groups = [
  {
    type: 'CUSTOMER',
    hits: [
      {
        id: 'c1',
        type: 'CUSTOMER',
        title: 'Ayesha Khan',
        subtitle: '0300-1234567',
        href: '/customers/c1',
      },
    ],
  },
  {
    type: 'PRODUCT',
    hits: [
      { id: 'p1', type: 'PRODUCT', title: 'Milano Sofa', subtitle: 'SOFA-1', href: '/products/p1' },
      { id: 'p2', type: 'PRODUCT', title: 'Oslo Sofa', subtitle: 'SOFA-2', href: '/products/p2' },
    ],
  },
];

function setup(result: unknown = { query: 'sofa', groups }) {
  return mockApi({ 'GET /search': () => result });
}

describe('GlobalSearch', () => {
  beforeEach(() => push.mockClear());

  it("shows results grouped by type with the workspace's own words", async () => {
    const { calls } = setup();
    renderWithProviders(<GlobalSearch />, {
      session: { terminology: { customer: { singular: 'Guest', plural: 'Guests' } } },
    });
    await userEvent.type(screen.getByRole('combobox', { name: 'Search' }), 'sofa');
    const list = await screen.findByRole('listbox', { name: 'Search results' });
    expect(await within(list).findByRole('group', { name: 'Guests' })).toBeInTheDocument();
    expect(within(list).getByRole('group', { name: 'Products' })).toBeInTheDocument();
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(within(list).getByText('SOFA-1')).toBeInTheDocument();
    expect(calls.at(-1)?.query.get('q')).toBe('sofa');
  });

  it('waits for two characters, and does not search on every keystroke', async () => {
    const { calls } = setup();
    renderWithProviders(<GlobalSearch />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 's');
    await new Promise((r) => setTimeout(r, 350));
    expect(calls).toHaveLength(0);
    await userEvent.type(box, 'ofa');
    await screen.findByRole('option', { name: /Ayesha Khan/ });
    expect(calls).toHaveLength(1);
  });

  it('moves through results with the arrow keys and opens one with Enter', async () => {
    setup();
    renderWithProviders(<GlobalSearch />);
    const box = screen.getByRole('combobox');
    await userEvent.type(box, 'sofa');
    await screen.findAllByRole('option');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', options[1]?.id);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}'); // wraps to the last
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(push).toHaveBeenCalledWith('/products/p2');
    expect(box).toHaveValue('');
  });

  it('opens a result when clicked, and closes the list with Escape', async () => {
    setup();
    renderWithProviders(<GlobalSearch />);
    await userEvent.type(screen.getByRole('combobox'), 'sofa');
    await userEvent.click(await screen.findByRole('option', { name: /Milano Sofa/ }));
    expect(push).toHaveBeenCalledWith('/products/p1');

    await userEvent.type(screen.getByRole('combobox'), 'sofa');
    await screen.findAllByRole('option');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  it('says so when nothing matches, and when search fails', async () => {
    setup({ query: 'zzz', groups: [] });
    const { unmount } = renderWithProviders(<GlobalSearch />);
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText('No results for “zzz”')).toBeInTheDocument();
    unmount();

    mockApi({});
    renderWithProviders(<GlobalSearch />);
    await userEvent.type(screen.getByRole('combobox'), 'abc');
    expect(await screen.findByText('Search is not available right now.')).toBeInTheDocument();
  });

  it('jumps to the box when "/" is pressed outside a text field', async () => {
    setup();
    renderWithProviders(
      <>
        <button type="button">Elsewhere</button>
        <GlobalSearch />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    await userEvent.keyboard('/');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  });
});
