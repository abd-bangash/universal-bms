import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { failure, mockApi, page, renderWithProviders } from '@/test/render';
import { StaffList, type StaffMember } from './staff-list';

const member = (over: Partial<StaffMember> = {}): StaffMember => ({
  id: 'u1',
  membershipId: 'm1',
  email: 'sam@acme.test',
  firstName: 'Sam',
  lastName: 'Seller',
  status: 'ACTIVE',
  phone: '+92 300 1',
  jobTitle: 'Showroom lead',
  employeeCode: 'E-1',
  joinDate: '2026-01-15T00:00:00.000Z',
  isSalesperson: true,
  defaultLocationId: null,
  roles: [{ id: 'r-sales', name: 'Salesperson' }],
  ...over,
});

const roles = [
  {
    id: 'r-owner',
    name: 'Owner',
    isOwner: true,
    isSystem: true,
    permissions: [],
    maxDiscountPercent: '100',
    viewerModules: [],
    memberCount: 1,
  },
  {
    id: 'r-sales',
    name: 'Salesperson',
    isOwner: false,
    isSystem: true,
    permissions: [],
    maxDiscountPercent: '5',
    viewerModules: [],
    memberCount: 1,
  },
  {
    id: 'r-cash',
    name: 'Cashier',
    isOwner: false,
    isSystem: true,
    permissions: [],
    maxDiscountPercent: '0',
    viewerModules: [],
    memberCount: 0,
  },
];

const admin = {
  permissions: [
    'user:view',
    'user:create',
    'user:edit',
    'user:deactivate',
    'role:view',
    'role:configure',
  ],
};

function setup(members: StaffMember[] = [member()], extra: Record<string, () => unknown> = {}) {
  return mockApi({
    'GET /users': () => page(members, { total: members.length }),
    'GET /roles': () => roles,
    ...extra,
  });
}

describe('StaffList', () => {
  it('lists staff with roles and a status badge', async () => {
    setup([
      member(),
      member({
        id: 'u2',
        firstName: 'Gone',
        lastName: 'Away',
        email: 'gone@acme.test',
        status: 'INACTIVE',
        roles: [{ id: 'r-cash', name: 'Cashier' }],
      }),
    ]);
    renderWithProviders(<StaffList />, { session: admin });
    expect(await screen.findByRole('button', { name: 'Sam Seller' })).toBeInTheDocument();
    expect(screen.getByText('sam@acme.test')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Salesperson')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
    expect(within(table).getByText('Deactivated')).toBeInTheDocument();
  });

  it('filters by status and role through the API', async () => {
    const { calls } = setup();
    renderWithProviders(<StaffList />, { session: admin });
    await screen.findByRole('button', { name: 'Sam Seller' });
    await userEvent.selectOptions(await screen.findByLabelText('Role'), 'r-cash');
    await waitFor(() => expect(calls.at(-1)?.query.get('roleId')).toBe('r-cash'));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'INACTIVE');
    await waitFor(() => expect(calls.at(-1)?.query.get('status')).toBe('INACTIVE'));
  });

  it('offers invitations only to people who may create users', async () => {
    setup();
    const { unmount } = renderWithProviders(<StaffList />, { session: admin });
    expect(await screen.findByRole('button', { name: 'Invite someone' })).toBeInTheDocument();
    unmount();
    renderWithProviders(<StaffList />, { session: { permissions: ['user:view'] } });
    await screen.findByRole('button', { name: 'Sam Seller' });
    expect(screen.queryByRole('button', { name: 'Invite someone' })).not.toBeInTheDocument();
  });
});

describe('invitations', () => {
  it('creates an invitation and shows the link once, to be passed on', async () => {
    const { calls } = setup([member()], {
      'POST /users/invite': () => ({
        id: 'i1',
        email: 'new@acme.test',
        token: 'tok123',
        expiresAt: '2026-10-11T00:00:00.000Z',
      }),
    });
    renderWithProviders(<StaffList />, { session: admin });
    await userEvent.click(await screen.findByRole('button', { name: 'Invite someone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite someone' });
    await userEvent.type(within(dialog).getByLabelText('Email address'), 'new@acme.test');
    await userEvent.click(await within(dialog).findByLabelText('Cashier'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create invitation' }));
    expect(
      await screen.findByDisplayValue(`${window.location.origin}/invite/tok123`),
    ).toBeInTheDocument();
    expect(screen.getByText(/Send this link to new@acme.test/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/users/invite')?.body).toEqual({
      email: 'new@acme.test',
      roleIds: ['r-cash'],
    });
  });

  it('shows the server’s field errors', async () => {
    setup([member()], {
      'POST /users/invite': () =>
        failure(400, 'VALIDATION_FAILED', { email: ['is already a member of this workspace'] }),
    });
    renderWithProviders(<StaffList />, { session: admin });
    await userEvent.click(await screen.findByRole('button', { name: 'Invite someone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite someone' });
    await userEvent.type(within(dialog).getByLabelText('Email address'), 'sam@acme.test');
    await userEvent.click(await within(dialog).findByLabelText('Cashier'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create invitation' }));
    expect(await screen.findByText('is already a member of this workspace')).toBeInTheDocument();
  });
});

describe('StaffEditor', () => {
  async function open(session = admin, extra: Record<string, () => unknown> = {}) {
    const api = setup([member()], extra);
    renderWithProviders(<StaffList />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Sam Seller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sam Seller' });
    return { ...api, dialog };
  }

  it('shows the profile and saves only after an edit, with roles when they changed', async () => {
    const { calls, dialog } = await open(admin, {
      'PATCH /users/u1': () =>
        member({
          jobTitle: 'Senior seller',
          roles: [
            { id: 'r-sales', name: 'Salesperson' },
            { id: 'r-cash', name: 'Cashier' },
          ],
        }),
    });
    expect(within(dialog).getByLabelText('Job title')).toHaveValue('Showroom lead');
    expect(within(dialog).getByLabelText('Join date')).toHaveValue('2026-01-15');
    expect(within(dialog).getByLabelText('Salesperson')).toBeChecked();
    await userEvent.clear(within(dialog).getByLabelText('Job title'));
    await userEvent.type(within(dialog).getByLabelText('Job title'), 'Senior seller');
    await userEvent.click(within(dialog).getByLabelText('Cashier'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    const body = calls.find((c) => c.method === 'PATCH')?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      firstName: 'Sam',
      jobTitle: 'Senior seller',
      joinDate: '2026-01-15',
      isSalesperson: true,
    });
    expect([...(body.roleIds as string[])].sort()).toEqual(['r-cash', 'r-sales']);
  });

  it('leaves roles out of the request when they did not change', async () => {
    const { calls, dialog } = await open(admin, { 'PATCH /users/u1': () => member() });
    await userEvent.type(within(dialog).getByLabelText('Phone'), '9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved.');
    expect(calls.find((c) => c.method === 'PATCH')?.body).not.toHaveProperty('roleIds');
  });

  it('does not let people without role:configure change roles (Requirement 2.9)', async () => {
    const { dialog } = await open({ permissions: ['user:view', 'user:edit', 'role:view'] });
    expect(within(dialog).getByLabelText('Cashier')).toBeDisabled();
    expect(
      within(dialog).getByText('You need permission to configure roles to change these.'),
    ).toBeInTheDocument();
  });

  it('is read-only without user:edit', async () => {
    const { dialog } = await open({ permissions: ['user:view'] });
    expect(within(dialog).getByLabelText('Job title')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Create a reset link' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });

  it('shows the server’s message when saving is refused', async () => {
    const { dialog } = await open(admin, {
      'PATCH /users/u1': () =>
        failure(400, 'VALIDATION_FAILED', {
          roleIds: ['the workspace must keep at least one active Owner'],
        }),
    });
    await userEvent.click(within(dialog).getByLabelText('Cashier'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Please check the highlighted fields.')).toBeInTheDocument();
  });

  it('deactivates after a confirmation and can reactivate', async () => {
    const { calls, dialog } = await open(admin, {
      'POST /users/u1/deactivate': () => member({ status: 'INACTIVE' }),
      'POST /users/u1/reactivate': () => member({ status: 'ACTIVE' }),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate Sam Seller?' });
    expect(within(confirm).getByText(/signed out at once/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Sam Seller was deactivated.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/users/u1/deactivate')).toBe(true);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Reactivate' }));
    expect(await screen.findByText('Sam Seller was reactivated.')).toBeInTheDocument();
  });

  it('shows the server’s refusal to deactivate the last Owner', async () => {
    const { dialog } = await open(admin, {
      'POST /users/u1/deactivate': () =>
        failure(400, 'VALIDATION_FAILED', {
          userId: ['the workspace must keep at least one active Owner'],
        }),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate Sam Seller?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Please check the highlighted fields.')).toBeInTheDocument();
  });

  it('creates a one-time reset link for a colleague who forgot their password', async () => {
    const { dialog } = await open(admin, {
      'POST /users/u1/reset-link': () => ({
        token: 'reset123',
        expiresAt: '2026-10-08T10:00:00.000Z',
      }),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create a reset link' }));
    expect(
      await screen.findByDisplayValue(`${window.location.origin}/reset-password?token=reset123`),
    ).toBeInTheDocument();
    expect(screen.getByText(/works once and expires in one hour/)).toBeInTheDocument();
  });
});
