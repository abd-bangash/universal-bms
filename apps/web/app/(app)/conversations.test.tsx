import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { failure, mockApi, page, renderWithProviders } from '@/test/render';
import { ConversationsPanel } from '@/components/crm/conversations-panel';
import { Inbox } from './conversations/inbox';

let search = '';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/conversations',
  useSearchParams: () => new URLSearchParams(search),
}));

const conversation = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  channelType: 'WHATSAPP',
  status: 'OPEN',
  contactName: 'Sana Malik',
  contactPhone: '923331234567',
  externalContactId: '923331234567',
  customerId: null,
  customerName: null,
  leadId: 'l1',
  leadName: 'Sana Malik',
  assignedToId: null,
  assignedToName: null,
  unreadCount: 2,
  automationActive: true,
  automationEffective: false,
  aiEnabled: true,
  needsHuman: false,
  needsHumanReason: null,
  lastMessageAt: '2026-03-10T09:00:00.000Z',
  lastInboundAt: '2026-03-10T09:00:00.000Z',
  lastMessagePreview: 'I want a sofa',
  lastMessageDirection: 'INBOUND',
  canSendFreeform: true,
  optedOut: false,
  ...over,
});
const msg = (over: Record<string, unknown>) => ({
  id: 'm',
  direction: 'INBOUND',
  senderType: 'CUSTOMER',
  senderUserId: null,
  senderName: null,
  type: 'TEXT',
  body: 'text',
  attachments: [],
  templateId: null,
  status: 'RECEIVED',
  failureReason: null,
  providerTimestamp: '2026-03-10T09:00:00.000Z',
  channelMeta: null,
  ...over,
});
const template = (over: Record<string, unknown>) => ({
  id: 't',
  name: 'Template',
  kind: 'QUICK_REPLY',
  body: 'Hello',
  variables: [],
  providerName: null,
  language: null,
  providerStatus: null,
  active: true,
  ...over,
});

const agent = {
  permissions: [
    'conversation:view',
    'conversation:reply',
    'conversation:assign',
    'template:view',
    'lead:create',
    'order:create',
    'quotation:view',
    'order:view',
  ],
};

function routes(extra: Record<string, () => unknown> = {}) {
  return {
    'GET /conversations': () => page([conversation()]),
    'GET /conversations/c1': () => conversation(),
    'GET /conversations/c1/messages': () =>
      // newest first, as the API sends them
      page([
        msg({
          id: 'm3',
          direction: 'OUTBOUND',
          senderType: 'STAFF',
          senderName: 'Ada Lovelace',
          body: 'Yes, 3 weeks',
          status: 'READ',
          providerTimestamp: '2026-03-10T09:05:00.000Z',
        }),
        msg({
          id: 'm2',
          direction: 'OUTBOUND',
          senderType: 'STAFF',
          body: 'Not sent one',
          status: 'FAILED',
          failureReason: 'PROVIDER_ERROR',
          providerTimestamp: '2026-03-10T09:03:00.000Z',
        }),
        msg({ id: 'm1', body: 'I want a sofa', providerTimestamp: '2026-03-10T09:00:00.000Z' }),
      ]),
    'POST /conversations/c1/read': () => conversation({ unreadCount: 0 }),
    'GET /templates': () => [
      template({ id: 'q1', name: 'Thanks', kind: 'QUICK_REPLY', body: 'Thanks!' }),
      template({ id: 'b1', name: 'Bank', kind: 'BANK_DETAILS', body: '{{bank_details}}' }),
      template({
        id: 'm1',
        name: 'Balance reminder',
        kind: 'MESSAGE',
        body: 'Balance {{balance_due}}',
        variables: ['balance_due'],
      }),
      template({
        id: 'p1',
        name: 'Follow up (en)',
        kind: 'PROVIDER',
        body: 'Hi {{1}}, still keen on {{2}}?',
        variables: ['1', '2'],
        providerName: 'follow_up',
        language: 'en',
        providerStatus: 'APPROVED',
      }),
      template({
        id: 'p2',
        name: 'Pending one',
        kind: 'PROVIDER',
        body: 'x',
        providerStatus: 'PENDING',
      }),
    ],
    ...extra,
  };
}

describe('Inbox', () => {
  beforeEach(() => {
    search = '';
  });

  it('lists conversations with an unread badge, the last message and who has it', async () => {
    mockApi(routes());
    renderWithProviders(<Inbox />, { session: agent });
    const row = await screen.findByRole('link', { name: /Sana Malik/ });
    expect(within(row).getByLabelText('2 unread')).toBeInTheDocument();
    expect(within(row).getByText('I want a sofa')).toBeInTheDocument();
    expect(within(row).getByText('Unassigned')).toBeInTheDocument();
    expect(row).toHaveAttribute('href', '/conversations?open=c1');
    expect(screen.getByText('Choose a conversation to read it.')).toBeInTheDocument();
  });

  it('filters by status, assignment, unread and needs-a-person, and searches by text', async () => {
    const { calls } = mockApi(routes());
    renderWithProviders(<Inbox />, { session: agent });
    await screen.findByRole('link', { name: /Sana Malik/ });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Status'), 'CLOSED');
    await user.selectOptions(screen.getByLabelText('Assigned to'), 'me');
    await user.click(screen.getByLabelText('Unread only'));
    await user.click(screen.getByLabelText('Needs a person'));
    await user.type(screen.getByLabelText('Search conversations'), 'sana');
    await waitFor(() => {
      const last = calls.filter((c) => c.path === '/conversations').pop();
      expect(last?.query.get('status')).toBe('CLOSED');
      expect(last?.query.get('assigned')).toBe('me');
      expect(last?.query.get('unread')).toBe('true');
      expect(last?.query.get('needsHuman')).toBe('true');
      expect(last?.query.get('q')).toBe('sana');
    });
  });

  it('says so when nothing matches, and shows errors', async () => {
    mockApi({ 'GET /conversations': () => page([]) });
    const { unmount } = renderWithProviders(<Inbox />, { session: agent });
    expect(await screen.findByText('No conversations match.')).toBeInTheDocument();
    unmount();
    mockApi({ 'GET /conversations': () => failure(403, 'PERMISSION_DENIED') });
    renderWithProviders(<Inbox />, { session: agent });
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
  });

  it('shows the conversation alone on a narrow screen once one is opened', async () => {
    search = 'open=c1';
    mockApi(routes());
    renderWithProviders(<Inbox />, { session: agent });
    await screen.findByRole('list', { name: 'Messages' });
    // the list pane is hidden below the md breakpoint while a conversation is open
    expect(
      screen.getByRole('search', { name: 'Filter conversations' }).closest('section'),
    ).toHaveClass('hidden', 'md:flex');
    expect(screen.getByRole('link', { name: 'All conversations' })).toHaveAttribute(
      'href',
      '/conversations',
    );
  });
});

describe('Thread', () => {
  beforeEach(() => {
    search = 'open=c1';
  });

  it('shows messages oldest first with delivery marks, marks the conversation read and shows the contact', async () => {
    const { calls } = mockApi(routes());
    renderWithProviders(<Inbox />, { session: agent });
    const thread = await screen.findByRole('list', { name: 'Messages' });
    await waitFor(() => expect(within(thread).getAllByRole('listitem')).toHaveLength(3));
    const bubbles = within(thread)
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '');
    expect(bubbles[0]).toContain('I want a sofa');
    expect(bubbles[1]).toContain('Not sent one');
    expect(bubbles[2]).toContain('Yes, 3 weeks');
    expect(within(thread).getByRole('img', { name: 'Read' })).toBeInTheDocument();
    expect(within(thread).getByRole('img', { name: 'Not sent' })).toHaveAttribute(
      'title',
      expect.stringContaining('PROVIDER_ERROR'),
    );
    expect(within(thread).getByText('Sent by Ada Lovelace')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/conversations/c1/read')).toBe(
        true,
      ),
    );
    const contact = screen.getByRole('complementary', { name: 'Contact' });
    expect(within(contact).getByText('923331234567')).toBeInTheDocument();
    expect(within(contact).getByRole('link', { name: 'Open lead' })).toHaveAttribute(
      'href',
      '/leads/l1',
    );
    expect(within(contact).getByText('Not linked to a customer yet.')).toBeInTheDocument();
  });

  it('shows an image in place, a document as a link, a location with a map link and an unsupported message as such', async () => {
    mockApi(
      routes({
        'GET /conversations/c1/messages': () =>
          page([
            msg({ id: 'a', body: null, type: 'UNSUPPORTED' }),
            msg({
              id: 'b',
              body: null,
              type: 'LOCATION',
              channelMeta: { location: { latitude: 24.8, longitude: 67, name: 'Showroom' } },
            }),
            msg({
              id: 'c',
              body: 'the spec',
              type: 'DOCUMENT',
              attachments: [{ fileId: 'f2', name: 'spec.pdf', mime: 'application/pdf' }],
            }),
            msg({
              id: 'd',
              body: 'like this',
              type: 'IMAGE',
              attachments: [{ fileId: 'f1', name: 'sofa.jpg', mime: 'image/jpeg' }],
            }),
          ]),
        'GET /files/f1/url': () => ({
          url: 'https://files.test/f1',
          thumbnailUrl: 'https://files.test/f1.thumb',
        }),
      }),
    );
    renderWithProviders(<Inbox />, { session: agent });
    expect(await screen.findByRole('img', { name: 'sofa.jpg' })).toHaveAttribute(
      'src',
      'https://files.test/f1.thumb',
    );
    expect(screen.getByRole('button', { name: 'Open spec.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Showroom/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps?q=24.8,67',
    );
    expect(screen.getByText('This kind of message cannot be shown.')).toBeInTheDocument();
  });

  it('sends a reply with an idempotency key and shows server rules in words', async () => {
    let attempt = 0;
    const { calls } = mockApi(
      routes({
        'POST /conversations/c1/messages': () =>
          ++attempt === 1 ? failure(422, 'FREEFORM_WINDOW_CLOSED') : [msg({ id: 'new' })],
      }),
    );
    renderWithProviders(<Inbox />, { session: agent });
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Reply' }), 'Hello there');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an approved template can be sent now',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Sent.')).toBeInTheDocument();
    const posts = calls.filter(
      (c) => c.method === 'POST' && c.path === '/conversations/c1/messages',
    );
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toEqual({ body: 'Hello there' });
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  });

  it('sends quick replies and the bank details at once', async () => {
    const { calls } = mockApi(
      routes({ 'POST /conversations/c1/messages': () => [msg({ id: 'new' })] }),
    );
    renderWithProviders(<Inbox />, { session: agent });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thanks' }));
    await user.click(screen.getByRole('button', { name: 'Send bank details' }));
    await waitFor(() => {
      const bodies = calls
        .filter((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')
        .map((c) => c.body);
      expect(bodies).toEqual([{ templateId: 'q1' }, { templateId: 'b1' }]);
    });
  });

  it('sends a message template, and a provider template with its numbered values', async () => {
    const { calls } = mockApi(
      routes({ 'POST /conversations/c1/messages': () => [msg({ id: 'new' })] }),
    );
    renderWithProviders(<Inbox />, { session: agent });
    const user = userEvent.setup();
    const select = await screen.findByRole('combobox', { name: 'Templates' });
    expect(within(select).queryByRole('option', { name: 'Pending one' })).not.toBeInTheDocument(); // not approved
    await user.selectOptions(select, 'm1');
    await user.click(screen.getByRole('button', { name: 'Send template' }));
    await user.selectOptions(select, 'p1');
    await user.type(screen.getByLabelText('Value for 1'), 'Sana');
    await user.type(screen.getByLabelText('Value for 2'), 'the sofa');
    await user.click(screen.getByRole('button', { name: 'Send template' }));
    await waitFor(() => {
      const bodies = calls
        .filter((c) => c.method === 'POST' && c.path === '/conversations/c1/messages')
        .map((c) => c.body);
      expect(bodies).toEqual([
        { templateId: 'm1' },
        { templateId: 'p1', parameters: ['Sana', 'the sofa'] },
      ]);
    });
  });

  it('outside the free-form window it explains and offers only templates', async () => {
    mockApi(routes({ 'GET /conversations/c1': () => conversation({ canSendFreeform: false }) }));
    renderWithProviders(<Inbox />, { session: agent });
    expect(await screen.findByText(/Only approved templates can be sent now/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thanks' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Templates' })).toBeInTheDocument();
  });

  it('attaches a quotation, with the typed note as its caption', async () => {
    const { calls } = mockApi(
      routes({
        'GET /quotations': () => [
          { id: 'q9', quotationNumber: 'QUO-0009', status: 'SENT', totalAmount: '4000' },
        ],
        'POST /conversations/c1/messages': () => [msg({ id: 'new' })],
      }),
    );
    renderWithProviders(<Inbox />, { session: agent });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Attach' }));
    const dialog = await screen.findByRole('dialog', { name: 'Attach a document', hidden: true });
    await user.type(within(dialog).getByLabelText(/Message to go with it/), 'Here is the quote');
    await user.click(
      await within(dialog).findByRole('button', { name: 'Send QUO-0009', hidden: true }),
    );
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.path === '/conversations/c1/messages',
      );
      expect(post?.body).toEqual({
        body: 'Here is the quote',
        attachments: [{ type: 'QUOTATION', id: 'q9' }],
      });
    });
    expect(calls.find((c) => c.path === '/quotations')?.query.get('leadId')).toBe('l1');
  });

  it('a person who may not reply sees the thread but no composer', async () => {
    mockApi(routes());
    renderWithProviders(<Inbox />, { session: { permissions: ['conversation:view'] } });
    await screen.findByRole('list', { name: 'Messages' });
    expect(screen.queryByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Conversation status' })).toBeDisabled();
  });

  it('changes status, assignee and the AI toggle, and hands back to automation', async () => {
    const { calls } = mockApi(
      routes({
        'GET /conversations/c1': () => conversation({ automationActive: false }),
        'GET /users': () =>
          page([{ id: 'u2', firstName: 'Bilal', lastName: 'Khan', status: 'ACTIVE' }]),
        'PATCH /conversations/c1': () => conversation(),
      }),
    );
    renderWithProviders(<Inbox />, {
      session: { permissions: [...agent.permissions, 'automation:configure', 'ai:control'] },
    });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Conversation status'), 'CLOSED');
    await user.selectOptions(await screen.findByLabelText('Assigned staff member'), 'u2');
    await user.click(screen.getByLabelText('AI assistant for this conversation'));
    await user.click(screen.getByRole('button', { name: 'Hand back to automation' }));
    await waitFor(() => {
      const bodies = calls.filter((c) => c.method === 'PATCH').map((c) => c.body);
      expect(bodies).toEqual([
        { status: 'CLOSED' },
        { assignedToId: 'u2' },
        { aiEnabled: false },
        { automationActive: true },
      ]);
    });
  });

  it('links a customer, creates a lead and offers to start an order', async () => {
    const { calls } = mockApi(
      routes({
        'GET /conversations/c1': () => conversation({ leadId: null, leadName: null }),
        'GET /customers': () => [
          { id: 'cu1', fullName: 'Known Customer', phones: ['+923001112222'], email: null },
        ],
        'PATCH /conversations/c1': () => conversation(),
        'POST /leads': () => ({ id: 'l9' }),
      }),
    );
    renderWithProviders(<Inbox />, { session: agent });
    const user = userEvent.setup();
    const contact = await screen.findByRole('complementary', { name: 'Contact' });
    await user.click(within(contact).getByRole('button', { name: 'Create a lead' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' && JSON.stringify(c.body) === JSON.stringify({ leadId: 'l9' }),
        ),
      ).toBe(true),
    );
    expect(calls.find((c) => c.method === 'POST' && c.path === '/leads')?.body).toMatchObject({
      fullName: 'Sana Malik',
      phone: '+923331234567',
      source: 'MESSAGING',
      channel: 'WHATSAPP',
    });
    await user.click(within(contact).getByRole('button', { name: 'Link to an existing customer' }));
    await user.type(within(contact).getByRole('textbox'), 'Known');
    await user.click(await within(contact).findByText('Known Customer'));
    await user.click(within(contact).getByRole('button', { name: 'Link to an existing customer' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'PATCH' &&
            JSON.stringify(c.body) === JSON.stringify({ customerId: 'cu1' }),
        ),
      ).toBe(true),
    );
  });

  it('offers to start an order when the conversation is linked to a customer', async () => {
    mockApi(
      routes({
        'GET /conversations/c1': () =>
          conversation({ customerId: 'cu1', customerName: 'Known Customer', leadId: null }),
      }),
    );
    renderWithProviders(<Inbox />, { session: agent });
    const contact = await screen.findByRole('complementary', { name: 'Contact' });
    expect(within(contact).getByRole('link', { name: 'Start an order' })).toHaveAttribute(
      'href',
      '/orders/new',
    );
    expect(within(contact).getByRole('link', { name: 'Open customer' })).toHaveAttribute(
      'href',
      '/customers/cu1',
    );
    expect(
      within(contact).queryByRole('button', { name: 'Link to an existing customer' }),
    ).not.toBeInTheDocument();
  });
});

describe('ConversationsPanel', () => {
  it("lists a customer's conversations with a link into the inbox, only for people who may view them", async () => {
    const { calls } = mockApi({ 'GET /conversations': () => page([conversation()]) });
    renderWithProviders(<ConversationsPanel customerId="cu1" />, { session: agent });
    expect(await screen.findByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/conversations?open=c1',
    );
    expect(calls[0]?.query.get('customerId')).toBe('cu1');
  });

  it('shows nothing without the permission', () => {
    const { calls } = mockApi({});
    renderWithProviders(<ConversationsPanel leadId="l1" />, {
      session: { permissions: ['lead:view'] },
    });
    expect(screen.queryByText('Conversations')).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
