import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { failure, mockApi, renderWithProviders } from '@/test/render';
import { RolesManager } from './roles-manager';

const role = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Salesperson',
  isSystem: true,
  isOwner: false,
  permissions: ['customer:view', 'order:view'],
  maxDiscountPercent: '5',
  viewerModules: [],
  memberCount: 3,
  ...over,
});

const catalogue = {
  resources: [
    {
      resource: 'customer',
      actions: ['view', 'create'],
      permissions: ['customer:view', 'customer:create'],
    },
    { resource: 'order', actions: ['view', 'cancel'], permissions: ['order:view', 'order:cancel'] },
  ],
  permissions: ['customer:view', 'customer:create', 'order:view', 'order:cancel'],
};

const roles = [
  role({
    id: 'r-owner',
    name: 'Owner',
    isOwner: true,
    permissions: catalogue.permissions,
    maxDiscountPercent: '100',
    memberCount: 1,
  }),
  role(),
  role({
    id: 'r-custom',
    name: 'Showroom',
    isSystem: false,
    permissions: ['customer:view'],
    maxDiscountPercent: '7.5',
    memberCount: 2,
  }),
];

const configurer = { permissions: ['role:view', 'role:configure'] };

function setup(extra: Record<string, (req: { body: unknown }) => unknown> = {}) {
  return mockApi({ 'GET /roles': () => roles, 'GET /permissions': () => catalogue, ...extra });
}

describe('RolesManager', () => {
  it('lists roles with their permission counts, discount limits and members', async () => {
    setup();
    renderWithProviders(<RolesManager />, { session: configurer });
    await screen.findByRole('button', { name: 'Showroom' });
    const table = screen.getByRole('table', { name: 'Roles' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[3]!).getByText('Showroom')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Custom')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('7.5')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Built in')).toBeInTheDocument();
  });

  it('creates a role from grouped permissions, with select-all per group', async () => {
    const { calls } = setup({
      'POST /roles': ({ body }) =>
        role({ id: 'new', name: (body as { name: string }).name, isSystem: false }),
    });
    renderWithProviders(<RolesManager />, { session: configurer });
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Warehouse');
    await userEvent.clear(within(dialog).getByLabelText('Largest discount allowed (%)'));
    await userEvent.type(within(dialog).getByLabelText('Largest discount allowed (%)'), '2.5');
    const customers = await within(dialog).findByRole('group', { name: 'Customers permissions' });
    await userEvent.click(within(customers).getByLabelText('Select all Customers'));
    await userEvent.click(
      within(dialog)
        .getByRole('group', { name: 'Orders permissions' })
        .querySelector('input[type="checkbox"]:not([aria-label])') as HTMLElement,
    );
    expect(within(dialog).getByText('3 of 4 selected')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(await screen.findByText('Role created.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Warehouse',
      permissions: ['customer:create', 'customer:view', 'order:view'],
      maxDiscountPercent: 2.5,
    });
  });

  it('shows a partly selected group as indeterminate and clears it in one click', async () => {
    setup();
    renderWithProviders(<RolesManager />, { session: configurer });
    await userEvent.click(await screen.findByRole('button', { name: 'Showroom' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit role: Showroom' });
    const toggle = (await within(dialog).findByLabelText(
      'Select all Customers',
    )) as HTMLInputElement;
    expect(toggle.indeterminate).toBe(true);
    await userEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    await userEvent.click(toggle);
    expect(toggle.checked).toBe(false);
  });

  it('edits an existing role', async () => {
    const { calls } = setup({
      'PATCH /roles/r-custom': () => role({ id: 'r-custom', name: 'Showroom staff' }),
    });
    renderWithProviders(<RolesManager />, { session: configurer });
    await userEvent.click(await screen.findByRole('button', { name: 'Showroom' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit role: Showroom' });
    await userEvent.clear(within(dialog).getByLabelText('Name'));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Showroom staff');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(await screen.findByText('Role saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      name: 'Showroom staff',
      permissions: ['customer:view'],
    });
  });

  it('requires a name before calling the server, and shows the server’s messages', async () => {
    const { calls } = setup({
      'POST /roles': () =>
        failure(400, 'VALIDATION_FAILED', { name: ['a role with this name already exists'] }),
    });
    renderWithProviders(<RolesManager />, { session: configurer });
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(await within(dialog).findByText('Enter a name.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Manager');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(
      await within(dialog).findByText('a role with this name already exists'),
    ).toBeInTheDocument();
  });

  it('shows the Owner role read-only', async () => {
    setup();
    renderWithProviders(<RolesManager />, { session: configurer });
    await userEvent.click(await screen.findByRole('button', { name: 'Owner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit role: Owner' });
    expect(within(dialog).getByText(/always has every permission/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument();
    expect(await within(dialog).findByText('4 of 4 selected')).toBeInTheDocument();
  });

  it('is view-only without role:configure', async () => {
    setup();
    renderWithProviders(<RolesManager />, { session: { permissions: ['role:view'] } });
    await screen.findByRole('button', { name: 'Showroom' });
    expect(screen.queryByRole('button', { name: 'New role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Showroom' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit role: Showroom' });
    expect(within(dialog).getByLabelText('Name')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Save role' })).not.toBeInTheDocument();
  });

  it('deletes a custom role, moving its people to a chosen role; built-in roles have no delete', async () => {
    const { calls } = setup({
      'DELETE /roles/r-custom': () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<RolesManager />, { session: configurer });
    await screen.findByRole('button', { name: 'Showroom' });
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete the role “Showroom”?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled(); // a fallback must be chosen first
    const select = within(dialog).getByLabelText('Move people to');
    expect(within(select).queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'Showroom' })).not.toBeInTheDocument();
    await userEvent.selectOptions(select, 'r1');
    await userEvent.click(confirm);
    expect(await screen.findByText('Role deleted.')).toBeInTheDocument();
    const call = calls.find((c) => c.method === 'DELETE');
    expect(call?.path).toBe('/roles/r-custom');
    expect(call?.query.get('fallbackRoleId')).toBe('r1');
  });

  it('shows why a deletion failed', async () => {
    setup({ 'DELETE /roles/r-custom': () => failure(400, 'VALIDATION_FAILED') });
    renderWithProviders(<RolesManager />, { session: configurer });
    await screen.findByRole('button', { name: 'Showroom' });
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete the role “Showroom”?' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Move people to'), 'r1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(screen.getByText('Please check the highlighted fields.')).toBeInTheDocument(),
    );
  });
});
