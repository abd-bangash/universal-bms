import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { jsonResponse, mockApi, page, renderWithProviders } from '@/test/render';
import type { CustomerView, LeadView, PipelineColumn } from '@/lib/hooks/use-crm';
import { NotesPanel } from '@/components/crm/notes-panel';
import { TasksPanel } from '@/components/crm/tasks-panel';
import { CustomerDetail } from './customers/customer-detail';
import { CustomerForm } from './customers/customer-form';
import { CustomerList } from './customers/customer-list';
import { LeadBoard } from './leads/lead-board';
import { LeadDetail } from './leads/lead-detail';
import { LeadForm } from './leads/lead-form';
import { LeadsHome } from './leads/leads-home';
import { LostReasonsPanel } from './settings/industry/lost-reasons-panel';
import { MyTasks } from './tasks/my-tasks';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/customers',
}));

const customer = (over: Partial<CustomerView> = {}): CustomerView => ({
  id: 'c1',
  fullName: 'Ayesha Khan',
  phones: ['0300-1234567'],
  email: 'ayesha@x.test',
  billingAddress: { line1: '12 Garden Rd', city: 'Karachi' },
  shippingAddress: null,
  preferredChannel: 'WHATSAPP',
  notes: null,
  tags: ['vip'],
  source: 'Instagram',
  channel: null,
  campaign: null,
  assignedToId: null,
  status: 'ACTIVE',
  customFields: {},
  version: 2,
  ...over,
});

const lead = (over: Partial<LeadView> = {}): LeadView => ({
  id: 'l1',
  customerId: null,
  fullName: 'Sana Malik',
  phone: '0300-7777777',
  email: null,
  source: 'SOCIAL',
  channel: null,
  campaign: null,
  interest: 'Corner sofa',
  productId: null,
  requirements: null,
  quantity: null,
  estimatedValue: '150000',
  quotedAmount: null,
  priority: 'HIGH',
  stage: 'new',
  assignedToId: null,
  lostReasonId: null,
  nextAction: null,
  nextActionDate: null,
  customFields: {},
  closedAt: null,
  version: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  allowedTransitions: [
    { to: 'contacted', requiredPermission: null, requiredFields: [], requiresApproval: false },
    { to: 'lost', requiredPermission: null, requiredFields: [], requiresApproval: false },
  ],
  ...over,
});

const column = (
  stage: string,
  label: string,
  over: Partial<PipelineColumn> = {},
): PipelineColumn => ({
  stage,
  label,
  color: '#64748b',
  category: 'IN_PROGRESS',
  systemRole: null,
  acceptsFrom: [],
  count: 0,
  value: '0',
  cards: [],
  ...over,
});

const board = (): PipelineColumn[] => [
  column('new', 'New', {
    systemRole: 'NEW',
    count: 1,
    value: '150000',
    cards: [
      {
        id: 'l1',
        fullName: 'Sana Malik',
        phone: '0300-7777777',
        interest: 'Corner sofa',
        estimatedValue: '150000',
        priority: 'HIGH',
        assignedToId: null,
        nextActionDate: null,
      },
    ],
  }),
  column('contacted', 'Contacted', { acceptsFrom: ['new'] }),
  column('won', 'Won', { systemRole: 'WON', category: 'DONE', acceptsFrom: ['new', 'contacted'] }),
  column('lost', 'Lost', {
    systemRole: 'LOST',
    category: 'CANCELLED',
    acceptsFrom: ['new', 'contacted'],
  }),
];

const salesPerms = [
  'customer:view',
  'customer:create',
  'customer:edit',
  'lead:view',
  'lead:create',
  'lead:edit',
  'task:view',
  'task:create',
  'task:edit',
];
const session = { permissions: salesPerms };

const base = {
  'GET /fields': () => [],
  'GET /settings/units': () => [],
};

describe('CustomerList', () => {
  it('lists customers, links to them, and filters through the API', async () => {
    const { calls } = mockApi({
      ...base,
      'GET /customers': () =>
        page([customer(), customer({ id: 'c2', fullName: 'Bob Baig', status: 'ARCHIVED' })]),
    });
    renderWithProviders(<CustomerList />, { session });
    expect(await screen.findByRole('link', { name: 'Ayesha Khan' })).toHaveAttribute(
      'href',
      '/customers/c1',
    );
    expect(screen.getAllByText('0300-1234567').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'New customer' })).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'ARCHIVED');
    await waitFor(() => expect(calls.at(-1)?.query.get('status')).toBe('ARCHIVED'));
  });
});

describe('CustomerForm', () => {
  beforeEach(() => push.mockClear());

  it('creates a customer: phone lines become a list and the user goes to the record', async () => {
    const { calls } = mockApi({ ...base, 'POST /customers': () => customer({ id: 'new1' }) });
    renderWithProviders(<CustomerForm customer={null} />, { session });
    await userEvent.type(await screen.findByLabelText(/^Full name/), '  Ayesha Khan ');
    await userEvent.type(
      screen.getByLabelText('Phone numbers'),
      '0300-1234567{enter}+92 321 7654321',
    );
    await userEvent.type(screen.getByLabelText('Tags'), 'vip, repeat');
    await userEvent.click(screen.getByRole('button', { name: 'Create customer' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/customers/new1'));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      fullName: 'Ayesha Khan',
      phones: ['0300-1234567', '+92 321 7654321'],
      tags: ['vip', 'repeat'],
      email: null,
    });
  });

  it('shows possible duplicates before saving, and saves anyway only when told to', async () => {
    let calls409 = 0;
    const { calls } = mockApi({
      ...base,
      'POST /customers': ({ body }) => {
        if ((body as { confirmDuplicate?: boolean }).confirmDuplicate)
          return customer({ id: 'forced' });
        calls409 += 1;
        return jsonResponse(
          {
            statusCode: 409,
            code: 'POSSIBLE_DUPLICATE',
            message: 'A customer like this already exists',
            data: {
              hasDuplicates: true,
              candidates: [
                {
                  id: 'c9',
                  fullName: 'Ayesha K.',
                  phones: ['0300-1234567'],
                  email: null,
                  reasons: ['PHONE'],
                },
              ],
            },
            requestId: 'r',
          },
          409,
        );
      },
    });
    renderWithProviders(<CustomerForm customer={null} />, { session });
    await userEvent.type(await screen.findByLabelText(/^Full name/), 'Ayesha Khan');
    await userEvent.type(screen.getByLabelText('Phone numbers'), '+92 300 1234567');
    await userEvent.click(screen.getByRole('button', { name: 'Create customer' }));

    expect(await screen.findByText('This looks like someone you already have')).toBeInTheDocument();
    expect(screen.getByText(/same phone/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/ })).toHaveAttribute('href', '/customers/c9');
    expect(push).not.toHaveBeenCalled();
    expect(calls409).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/customers/forced'));
    expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toMatchObject({
      confirmDuplicate: true,
    });
  });

  it('saves edits with the version it read', async () => {
    const { calls } = mockApi({
      ...base,
      'PATCH /customers/c1': () => customer({ version: 3, notes: 'Hello' }),
    });
    renderWithProviders(<CustomerForm customer={customer()} />, { session });
    await userEvent.type(await screen.findByLabelText('Notes'), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      version: 2,
      notes: 'Hello',
    });
  });

  it('is read-only without customer:edit', async () => {
    mockApi(base);
    renderWithProviders(<CustomerForm customer={customer()} />, {
      session: { permissions: ['customer:view'] },
    });
    expect(await screen.findByLabelText(/^Full name/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });
});

describe('CustomerDetail', () => {
  const routes = (extra: Record<string, () => unknown> = {}) =>
    mockApi({
      ...base,
      'GET /customers/c1': () => customer(),
      'GET /customers/c1/finance': () => ({
        lifetimeValue: '250000',
        totalPaid: '100000',
        outstandingBalance: '150000',
        creditBalance: '0',
      }),
      'GET /customers/c1/timeline': () =>
        page([
          {
            id: 't1',
            type: 'SYSTEM',
            summary: 'Customer record created',
            occurredAt: '2026-10-01T10:00:00.000Z',
          },
        ]),
      'GET /leads': () => page([lead({ customerId: 'c1' })]),
      'GET /tasks': () => page([]),
      'GET /notes': () => [],
      ...extra,
    });

  it('shows money, leads, the timeline, and archives after confirming', async () => {
    const { calls } = routes({
      'POST /customers/c1/archive': () => customer({ status: 'ARCHIVED' }),
    });
    renderWithProviders(<CustomerDetail customerId="c1" />, {
      session: { permissions: [...salesPerms, 'payment:view', 'customer:archive'] },
    });
    expect(await screen.findByRole('heading', { name: 'Ayesha Khan' })).toBeInTheDocument();
    expect(await screen.findByText('Lifetime value')).toBeInTheDocument();
    expect(await screen.findByText('Customer record created')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Sana Malik' })).toHaveAttribute(
      'href',
      '/leads/l1',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: /Archive Ayesha Khan/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/customers/c1/archive')).toBe(true));
  });

  it('hides money without payment:view and archive without customer:archive', async () => {
    routes();
    renderWithProviders(<CustomerDetail customerId="c1" />, { session });
    await screen.findByRole('heading', { name: 'Ayesha Khan' });
    expect(screen.queryByText('Lifetime value')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });
});

describe('NotesPanel', () => {
  it('adds a note and logs a call', async () => {
    const { calls } = mockApi({ 'GET /notes': () => [], 'POST /notes': () => ({}) });
    renderWithProviders(<NotesPanel entityType="CUSTOMER" entityId="c1" canWrite />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Add note' }));
    await userEvent.type(screen.getByLabelText('Note'), 'Prefers mornings');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        entityType: 'CUSTOMER',
        entityId: 'c1',
        body: 'Prefers mornings',
        kind: 'NOTE',
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Log a call' }));
    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'NO_ANSWER');
    await userEvent.type(screen.getByLabelText('Note'), 'Rang twice');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST')[1]?.body).toMatchObject({
      kind: 'CALL',
      callDirection: 'OUTBOUND',
      callOutcome: 'NO_ANSWER',
    });
  });

  it('shows notes and call logs, and no add buttons without permission', async () => {
    mockApi({
      'GET /notes': () => [
        {
          id: 'n1',
          kind: 'CALL',
          body: 'Asked for a price',
          callDirection: 'INBOUND',
          callOutcome: 'ANSWERED',
          createdByName: 'Sam Seller',
          createdAt: '2026-10-01T10:00:00.000Z',
        },
        {
          id: 'n2',
          kind: 'NOTE',
          body: 'Likes grey',
          callDirection: null,
          callOutcome: null,
          createdByName: 'Sam Seller',
          createdAt: '2026-09-30T10:00:00.000Z',
        },
      ],
    });
    renderWithProviders(<NotesPanel entityType="LEAD" entityId="l1" canWrite={false} />, {
      session,
    });
    expect(await screen.findByText('Call (incoming, answered)')).toBeInTheDocument();
    expect(screen.getByText('Likes grey')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  });
});

describe('TasksPanel', () => {
  it('lists open tasks for a record and completes one', async () => {
    const { calls } = mockApi({
      'GET /tasks': () =>
        page([
          {
            id: 't1',
            type: 'CALL',
            title: 'Ring Lola',
            description: null,
            dueAt: '2020-01-01T10:00:00.000Z',
            status: 'OPEN',
            assignedToId: 'u1',
            entityType: 'LEAD',
            entityId: 'l1',
            completedAt: null,
          },
        ]),
      'POST /tasks/t1/complete': () => ({}),
    });
    renderWithProviders(<TasksPanel entityType="LEAD" entityId="l1" />, { session });
    expect((await screen.findAllByText('Ring Lola')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    await waitFor(() => expect(calls.some((c) => c.path === '/tasks/t1/complete')).toBe(true));
    expect(calls.find((c) => c.path === '/tasks')?.query.get('entityId')).toBe('l1');
  });

  it('adds a task linked to the record', async () => {
    const { calls } = mockApi({ 'GET /tasks': () => page([]), 'POST /tasks': () => ({}) });
    renderWithProviders(<TasksPanel entityType="CUSTOMER" entityId="c1" />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Add task' }));
    const dialog = await screen.findByRole('dialog', { name: 'New task' });
    await userEvent.type(within(dialog).getByLabelText(/^Task/), 'Send brochure');
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'FOLLOW_UP');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      type: 'FOLLOW_UP',
      title: 'Send brochure',
      dueAt: null,
      entityType: 'CUSTOMER',
      entityId: 'c1',
    });
  });
});

describe('MyTasks', () => {
  const mk = (id: string, title: string) => ({
    id,
    type: 'TODO',
    title,
    description: null,
    dueAt: null,
    status: 'OPEN',
    assignedToId: 'u1',
    entityType: null,
    entityId: null,
    completedAt: null,
  });

  it('shows one bucket at a time with counts, and switches', async () => {
    const { calls } = mockApi({
      'GET /tasks': ({ url }) => {
        const due = url.searchParams.get('due');
        return page(
          due === 'overdue'
            ? [mk('t1', 'Late thing'), mk('t2', 'Later thing')]
            : due === 'today'
              ? [mk('t3', 'Today thing')]
              : [],
        );
      },
    });
    renderWithProviders(<MyTasks />, { session });
    expect((await screen.findAllByText('Late thing')).length).toBeGreaterThan(0);
    expect(await screen.findByRole('tab', { name: /Overdue \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Today \(1\)/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Today/ }));
    expect((await screen.findAllByText('Today thing')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Late thing')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'CALL');
    await waitFor(() => expect(calls.at(-1)?.query.get('type')).toBe('CALL'));
  });
});

describe('LeadBoard', () => {
  const routes = (extra: Record<string, () => unknown> = {}) =>
    mockApi({
      'GET /leads/pipeline': () => board(),
      'GET /settings/lost-reasons': () => [
        { id: 'r1', name: 'Price too high', active: true },
        { id: 'r2', name: 'Chose a competitor', active: true },
      ],
      ...extra,
    });

  it('shows a column per stage with counts and values, and a card for each lead', async () => {
    routes();
    renderWithProviders(<LeadBoard />, { session });
    const newColumn = await screen.findByRole('region', { name: /New, 1 leads/ });
    expect(within(newColumn).getByRole('link', { name: 'Sana Malik' })).toHaveAttribute(
      'href',
      '/leads/l1',
    );
    expect(within(newColumn).getByText('Corner sofa')).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(4);
  });

  it('moves a lead by drag and drop onto a stage the workflow allows', async () => {
    const { calls } = routes({ 'POST /leads/l1/stage': () => ({ pendingApproval: false }) });
    renderWithProviders(<LeadBoard />, { session });
    const card = (await screen.findByRole('link', { name: 'Sana Malik' })).closest(
      'li',
    ) as HTMLElement;
    const contacted = screen.getByRole('region', { name: /Contacted/ });
    fireEvent.dragStart(card);
    fireEvent.dragOver(contacted);
    fireEvent.drop(contacted);
    await waitFor(() => expect(calls.some((c) => c.path === '/leads/l1/stage')).toBe(true));
    expect(calls.find((c) => c.path === '/leads/l1/stage')?.body).toEqual({ stage: 'contacted' });
  });

  it('does not drop onto the stage the card is already in', async () => {
    const { calls } = routes({ 'POST /leads/l1/stage': () => ({}) });
    renderWithProviders(<LeadBoard />, { session });
    const card = (await screen.findByRole('link', { name: 'Sana Malik' })).closest(
      'li',
    ) as HTMLElement;
    fireEvent.dragStart(card);
    fireEvent.drop(screen.getByRole('region', { name: /New, 1 leads/ }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('offers the same move through a menu on the card', async () => {
    const { calls } = routes({ 'POST /leads/l1/stage': () => ({}) });
    renderWithProviders(<LeadBoard />, { session });
    const select = await screen.findByLabelText('Move Sana Malik to');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Move to…', 'Contacted', 'Won', 'Lost']);
    await userEvent.selectOptions(select, 'won');
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/leads/l1/stage')?.body).toEqual({ stage: 'won' }),
    );
  });

  it('asks why before a lead is marked lost, and will not move without a reason', async () => {
    const { calls } = routes({ 'POST /leads/l1/stage': () => ({}) });
    renderWithProviders(<LeadBoard />, { session });
    await userEvent.selectOptions(await screen.findByLabelText('Move Sana Malik to'), 'lost');
    const dialog = await screen.findByRole('dialog', { name: 'Why was this lead lost?' });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as lost' }));
    expect(await within(dialog).findByText('Choose a reason.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Reason/), 'r1');
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'Found it cheaper');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as lost' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/leads/l1/stage')?.body).toEqual({
        stage: 'lost',
        lostReasonId: 'r1',
        note: 'Found it cheaper',
      }),
    );
  });

  it("shows the server's refusal when a move is not allowed", async () => {
    routes({
      'POST /leads/l1/stage': () =>
        jsonResponse(
          { statusCode: 422, code: 'TRANSITION_NOT_ALLOWED', message: 'x', requestId: 'r' },
          422,
        ),
    });
    renderWithProviders(<LeadBoard />, { session });
    await userEvent.selectOptions(await screen.findByLabelText('Move Sana Malik to'), 'contacted');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('cannot move cards without lead:edit', async () => {
    routes();
    renderWithProviders(<LeadBoard />, { session: { permissions: ['lead:view'] } });
    await screen.findByRole('link', { name: 'Sana Malik' });
    expect(screen.queryByLabelText('Move Sana Malik to')).not.toBeInTheDocument();
  });
});

describe('LeadsHome', () => {
  it('switches between the board and the list over the same data', async () => {
    mockApi({
      'GET /leads/pipeline': () => board(),
      'GET /leads': () => page([lead()]),
    });
    renderWithProviders(<LeadsHome />, { session });
    expect(await screen.findByRole('region', { name: /New, 1 leads/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Sana Malik' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New lead' })).toBeInTheDocument();
  });
});

describe('LeadForm', () => {
  beforeEach(() => push.mockClear());

  it('creates a lead and goes to it', async () => {
    const { calls } = mockApi({
      ...base,
      'POST /leads': () => ({ ...lead({ id: 'new1' }), existing: false }),
      'GET /leads/pipeline': () => board(),
    });
    renderWithProviders(<LeadForm lead={null} />, { session });
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Sana Malik');
    await userEvent.type(screen.getByLabelText('Phone'), '0300-7777777');
    await userEvent.type(screen.getByLabelText(/^Estimated value/), '150000');
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'HIGH');
    await userEvent.click(screen.getByRole('button', { name: 'Create lead' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/leads/new1'));
    const body = calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      fullName: 'Sana Malik',
      phone: '0300-7777777',
      priority: 'HIGH',
      estimatedValue: '150000.00',
    });
    expect(typeof body.estimatedValue).toBe('string');
  });

  it('offers the existing lead instead of creating a repeat, and creates anyway on request', async () => {
    let anyway = false;
    const { calls } = mockApi({
      ...base,
      'GET /leads/pipeline': () => board(),
      'POST /leads': ({ body }) => {
        anyway = Boolean((body as { allowDuplicate?: boolean }).allowDuplicate);
        return anyway
          ? { ...lead({ id: 'forced' }), existing: false }
          : { ...lead({ id: 'old1', fullName: 'Sana M.' }), existing: true };
      },
    });
    renderWithProviders(<LeadForm lead={null} />, { session });
    await userEvent.type(await screen.findByLabelText(/^Name/), 'Sana Malik');
    await userEvent.click(screen.getByRole('button', { name: 'Create lead' }));
    expect(await screen.findByText('This contact already has an open lead')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the existing lead' })).toHaveAttribute(
      'href',
      '/leads/old1',
    );
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Create anyway' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/leads/forced'));
    expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toMatchObject({
      allowDuplicate: true,
    });
  });

  it('shows the furniture requirement fields only for custom sizes', async () => {
    mockApi({
      'GET /fields': () => [
        {
          id: 'f1',
          key: 'size_type',
          label: 'Size type',
          type: 'DROPDOWN',
          options: [
            { key: 'standard', label: 'Standard' },
            { key: 'custom', label: 'Custom' },
          ],
          isVariantAxis: false,
          sortOrder: 0,
          active: true,
        },
        {
          id: 'f2',
          key: 'length',
          label: 'Length',
          type: 'MEASUREMENT',
          unitDimension: 'length',
          defaultUnit: 'ft',
          isVariantAxis: false,
          sortOrder: 1,
          active: true,
          visibleWhen: { source: 'field', key: 'size_type', op: 'eq', value: 'custom' },
        },
      ],
      'GET /settings/units': () => [{ id: 'u1', name: 'Foot', symbol: 'ft', dimension: 'length' }],
    });
    renderWithProviders(<LeadForm lead={null} />, { session });
    const size = await screen.findByLabelText('Size type');
    expect(screen.queryByLabelText('Length')).not.toBeInTheDocument();
    await userEvent.selectOptions(size, 'custom');
    expect(await screen.findByText('Length')).toBeInTheDocument();
  });

  it('sends the version when editing', async () => {
    const { calls } = mockApi({
      ...base,
      'PATCH /leads/l1': () => lead({ version: 2 }),
      'GET /leads/pipeline': () => board(),
    });
    renderWithProviders(<LeadForm lead={lead()} />, { session });
    const interest = await screen.findByLabelText('What are they interested in?');
    await userEvent.clear(interest);
    await userEvent.type(interest, 'Dining set');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      version: 1,
      interest: 'Dining set',
    });
  });
});

describe('LeadDetail', () => {
  const routes = (extra: Record<string, () => unknown> = {}) =>
    mockApi({
      ...base,
      'GET /leads/l1': () => lead(),
      'GET /leads/pipeline': () => board(),
      'GET /leads/l1/attachments': () => [],
      'GET /leads/l1/timeline': () =>
        page([
          {
            id: 't1',
            type: 'STATUS',
            summary: 'Stage changed from New to Contacted',
            occurredAt: '2026-10-02T10:00:00.000Z',
          },
        ]),
      'GET /tasks': () => page([]),
      'GET /notes': () => [],
      'GET /settings/lost-reasons': () => [{ id: 'r1', name: 'Price too high', active: true }],
      ...extra,
    });

  it('shows the stage, the allowed next stages, and the history', async () => {
    const { calls } = routes({ 'POST /leads/l1/stage': () => ({}) });
    renderWithProviders(<LeadDetail leadId="l1" />, { session });
    expect(await screen.findByRole('heading', { name: 'Sana Malik' })).toBeInTheDocument();
    expect(await screen.findByText('Stage changed from New to Contacted')).toBeInTheDocument();
    const contacted = await screen.findByRole('button', { name: 'Contacted' });
    await userEvent.click(contacted);
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/leads/l1/stage')?.body).toEqual({ stage: 'contacted' }),
    );
    // lost asks for a reason first
    await userEvent.click(screen.getByRole('button', { name: 'Lost' }));
    expect(
      await screen.findByRole('dialog', { name: 'Why was this lead lost?' }),
    ).toBeInTheDocument();
  });

  it('converts to a customer and links to it', async () => {
    const { calls } = routes({
      'POST /leads/l1/convert': () => ({
        customer: customer({ id: 'cust9' }),
        created: true,
        lead: lead({ customerId: 'cust9' }),
      }),
    });
    renderWithProviders(<LeadDetail leadId="l1" />, { session });
    await userEvent.click(await screen.findByRole('button', { name: 'Convert to customer' }));
    const link = await screen.findByRole('link', { name: 'Open customer' });
    expect(link).toHaveAttribute('href', '/customers/cust9');
    expect(screen.getByText(/A new customer was created/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/leads/l1/convert')?.body).toEqual({ target: 'CUSTOMER' });
  });

  it('assigns staff only for people with lead:assign', async () => {
    const { calls } = routes({
      'GET /users': () =>
        page([{ id: 'u2', firstName: 'Mina', lastName: 'Manager', status: 'ACTIVE' }]),
      'POST /leads/l1/assign': () => lead(),
    });
    renderWithProviders(<LeadDetail leadId="l1" />, {
      session: { permissions: [...salesPerms, 'lead:assign', 'user:view'] },
    });
    await userEvent.selectOptions(
      await screen.findByLabelText('Assigned to', { selector: '#lead-assignee' }),
      'u2',
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/leads/l1/assign')?.body).toEqual({
        assignedToId: 'u2',
      }),
    );
  });

  it('hides editing controls from a viewer', async () => {
    routes();
    renderWithProviders(<LeadDetail leadId="l1" />, { session: { permissions: ['lead:view'] } });
    await screen.findByRole('heading', { name: 'Sana Malik' });
    expect(screen.queryByRole('button', { name: 'Contacted' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convert to customer' })).not.toBeInTheDocument();
  });
});

describe('LostReasonsPanel', () => {
  it('lists reasons, adds one and deactivates another', async () => {
    const { calls } = mockApi({
      'GET /settings/lost-reasons': () => [
        { id: 'r1', name: 'Price too high', active: true },
        { id: 'r2', name: 'Old reason', active: false },
      ],
      'POST /settings/lost-reasons': () => ({}),
      'PATCH /settings/lost-reasons/r1': () => ({}),
    });
    renderWithProviders(<LostReasonsPanel />, {
      session: { permissions: ['workspace:configure'] },
    });
    expect((await screen.findAllByText('Price too high')).length).toBeGreaterThan(0);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Reason'), 'Delivery too slow');
    await userEvent.click(screen.getByRole('button', { name: 'Add reason' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Delivery too slow' }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Deactivate Price too high/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ active: false }),
    );
  });

  it('is read-only without workspace:configure', async () => {
    mockApi({
      'GET /settings/lost-reasons': () => [{ id: 'r1', name: 'Price too high', active: true }],
    });
    renderWithProviders(<LostReasonsPanel />, { session: { permissions: ['workspace:view'] } });
    await screen.findAllByText('Price too high');
    expect(screen.queryByRole('button', { name: 'Add reason' })).not.toBeInTheDocument();
  });
});
