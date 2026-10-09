import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationNav } from '@/components/layout/automation-nav';
import { failure, mockApi, page, renderWithProviders } from '@/test/render';
import { AiPanel } from './conversations/ai-panel';
import { AiLog } from './automation/log/ai-log';
import { AiSettings } from './automation/ai/ai-settings';
import { TemplatesManager } from './automation/templates/templates-manager';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/automation/ai',
  useSearchParams: () => new URLSearchParams(''),
}));

const conversation = (over: Record<string, unknown> = {}) =>
  ({
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
    unreadCount: 0,
    automationActive: true,
    automationEffective: false,
    aiEnabled: true,
    needsHuman: false,
    needsHumanReason: null,
    lastMessageAt: null,
    lastInboundAt: null,
    lastMessagePreview: null,
    lastMessageDirection: null,
    canSendFreeform: true,
    optedOut: false,
    ...over,
  }) as never;

const status = (over: Record<string, unknown> = {}) => ({
  mode: 'ASSIST',
  moduleEnabled: true,
  providerConfigured: true,
  provider: 'ANTHROPIC',
  providers: ['ANTHROPIC'],
  settings: {
    provider: 'ANTHROPIC',
    model: '',
    tone: 'FRIENDLY',
    replyLanguage: 'MATCH_CUSTOMER',
    maxReplyChars: 600,
    confidenceThreshold: 0.7,
    escalationKeywords: ['refund', 'complaint'],
    contextMessageCount: 10,
  },
  usage: { requestsToday: 12, dailyLimit: 500, tokensThisMonth: 45000, monthlyBudget: 2000000 },
  ...over,
});

const suggestion = (
  type: string,
  payload: Record<string, unknown>,
  over: Record<string, unknown> = {},
) => ({
  id: `s-${type}`,
  conversationId: 'c1',
  leadId: 'l1',
  type,
  status: 'PENDING',
  payload,
  flags: [],
  confidence: 0.9,
  createdAt: '2026-03-10T09:00:00.000Z',
  decidedAt: null,
  decidedById: null,
  ...over,
});

const staff = { permissions: ['ai:use', 'lead:edit', 'conversation:reply'] };

describe('AiPanel', () => {
  it('says why the assistant is off before anyone tries, and disables the buttons', async () => {
    mockApi({
      'GET /ai/status': () => status({ mode: 'OFF' }),
      'GET /ai/conversations/c1/suggestions': () => [],
    });
    renderWithProviders(<AiPanel conversation={conversation()} />, { session: staff });
    expect(
      await screen.findByText(/The AI assistant is off for this workspace/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summarise' })).toBeDisabled();
  });

  it.each([
    [{ aiEnabled: false }, {}, /switched off for this conversation/],
    [{}, { providerConfigured: false }, /No AI service is connected/],
    [{}, { moduleEnabled: false }, /AI module is switched off/],
  ])('also says so when %j / %j', async (conv, st, text) => {
    mockApi({
      'GET /ai/status': () => status(st),
      'GET /ai/conversations/c1/suggestions': () => [],
    });
    renderWithProviders(<AiPanel conversation={conversation(conv)} />, { session: staff });
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Draft a reply' })).toBeDisabled();
  });

  it('is not shown to someone who may not use AI, and asks the server nothing', () => {
    const { calls } = mockApi({});
    renderWithProviders(<AiPanel conversation={conversation()} />, {
      session: { permissions: ['conversation:view'] },
    });
    expect(screen.queryByRole('complementary', { name: 'AI assistant' })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('asks for a function and reports a limit or a failure in words', async () => {
    let answer: unknown = { status: 'DISABLED', reason: 'DAILY_LIMIT' };
    const { calls } = mockApi({
      'GET /ai/status': () => status(),
      'GET /ai/conversations/c1/suggestions': () => [],
      'POST /ai/conversations/c1/extract': () => answer,
    });
    renderWithProviders(
      <AiPanel
        conversation={conversation({
          needsHuman: true,
          needsHumanReason: 'The customer used "refund".',
        })}
      />,
      { session: staff },
    );
    const user = userEvent.setup();
    expect(
      await screen.findByText(/Needs a person: The customer used "refund"/),
    ).toBeInTheDocument();
    expect(await screen.findByText('12 of 500 requests used today')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Read requirements' }));
    expect(
      await screen.findByText(/daily limit of AI requests has been reached/),
    ).toBeInTheDocument();
    answer = { status: 'FAILED', code: 'TIMEOUT' };
    await user.click(screen.getByRole('button', { name: 'Read requirements' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not answer (TIMEOUT)');
    expect(
      calls.filter((c) => c.method === 'POST' && c.path === '/ai/conversations/c1/extract'),
    ).toHaveLength(2);
  });

  it('shows what the customer wants with confidence per detail, what is missing and the products, and applies edited values', async () => {
    const { calls } = mockApi({
      'GET /ai/status': () => status(),
      'GET /ai/conversations/c1/suggestions': () => [
        suggestion(
          'EXTRACTION',
          {
            fields: [
              {
                key: 'interest',
                label: 'What they want',
                value: 'leather sofa',
                confidence: 0.95,
                level: 'HIGH',
                grounded: true,
              },
              {
                key: 'quantity',
                label: 'Quantity',
                value: '3',
                confidence: 0.3,
                level: 'LOW',
                grounded: false,
              },
            ],
            missingFields: [
              { key: 'delivery_city', label: 'Delivery city', question: 'Which city?' },
            ],
            nextQuestion: 'Which city should we deliver to?',
            productCandidates: [
              {
                productId: 'p1',
                name: 'Leather sofa',
                price: '45000',
                availability: 'IN_STOCK',
                score: 1,
              },
            ],
            noProductMatch: false,
            reasons: ['Some of what was extracted is not clearly stated in the conversation.'],
          },
          { flags: ['LOW_CONFIDENCE'] },
        ),
      ],
      'POST /ai/suggestions/s-EXTRACTION/apply': () => ({}),
    });
    renderWithProviders(<AiPanel conversation={conversation()} />, { session: staff });
    const card = await screen.findByRole('region', { name: 'What the customer wants' });
    expect(within(card).getByText('High 95%')).toBeInTheDocument();
    expect(within(card).getByText('Low 30%')).toBeInTheDocument();
    expect(within(card).getByText('Not stated in the chat')).toBeInTheDocument();
    expect(within(card).getByText('Delivery city')).toBeInTheDocument();
    expect(
      within(card).getByText('Next question to ask: Which city should we deliver to?'),
    ).toBeInTheDocument();
    expect(within(card).getByText(/Leather sofa · 45000 · In stock/)).toBeInTheDocument();
    const flags = within(card).getByRole('group', { name: 'Check before using' });
    expect(within(flags).getByText('Low confidence')).toBeInTheDocument();
    expect(within(flags).getByText(/not clearly stated/)).toBeInTheDocument();

    const user = userEvent.setup();
    const quantity = within(card).getByLabelText('Edit Quantity');
    await user.clear(quantity);
    await user.type(quantity, '1');
    await user.click(within(card).getByRole('button', { name: 'Add to lead' }));
    await waitFor(() => {
      const post = calls.find(
        (c) => c.method === 'POST' && c.path === '/ai/suggestions/s-EXTRACTION/apply',
      );
      expect(post?.body).toEqual({
        payload: {
          fields: [
            { key: 'interest', value: 'leather sofa' },
            { key: 'quantity', value: '1' },
          ],
          productId: 'p1',
        },
      });
    });
  });

  it('shows a draft reply with its flags, lets the person edit and send it, or dismiss it', async () => {
    const { calls } = mockApi({
      'GET /ai/status': () => status(),
      'GET /ai/conversations/c1/suggestions': () => [
        suggestion(
          'DRAFT_REPLY',
          {
            text: 'It is Rs 52,000.',
            reasons: ['The amount 52000 is not in the catalog or the approved texts.'],
          },
          { flags: ['UNVERIFIED_AMOUNT'] },
        ),
      ],
      'POST /ai/suggestions/s-DRAFT_REPLY/apply': () => ({}),
      'POST /ai/suggestions/s-DRAFT_REPLY/reject': () => ({}),
    });
    renderWithProviders(<AiPanel conversation={conversation()} />, { session: staff });
    const card = await screen.findByRole('region', { name: 'Draft reply' });
    const flags = within(card).getByRole('group', { name: 'Check before using' });
    expect(within(flags).getByText('Amount not checked')).toBeInTheDocument();
    expect(within(flags).getByText(/52000 is not in the catalog/)).toBeInTheDocument();
    const user = userEvent.setup();
    const text = within(card).getByLabelText('Edit the reply before sending');
    expect(text).toHaveValue('It is Rs 52,000.');
    await user.clear(text);
    await user.type(text, 'It is Rs 45,000.');
    await user.click(within(card).getByRole('button', { name: 'Send reply' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/ai/suggestions/s-DRAFT_REPLY/apply')?.body).toEqual({
        payload: { text: 'It is Rs 45,000.' },
      }),
    );
    await user.click(within(card).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/ai/suggestions/s-DRAFT_REPLY/reject')).toBe(true),
    );
  });

  it('applies a classification, a next step and a note, and offers no button for a summary', async () => {
    const { calls } = mockApi({
      'GET /ai/status': () => status(),
      'GET /ai/conversations/c1/suggestions': () => [
        suggestion('CLASSIFICATION', { intent: 'QUOTE_REQUEST', priority: 'HIGH' }),
        suggestion('NEXT_ACTION', { action: 'Call about the table', followUpDate: '2026-03-12' }),
        suggestion('NOTE', { text: 'Wants a call tomorrow.' }),
        suggestion('SUMMARY', { summary: 'Wants a dining table.', keyPoints: ['dining table'] }),
      ],
      'POST /ai/suggestions/s-CLASSIFICATION/apply': () => ({}),
      'POST /ai/suggestions/s-NEXT_ACTION/apply': () => ({}),
      'POST /ai/suggestions/s-NOTE/apply': () => ({}),
    });
    renderWithProviders(<AiPanel conversation={conversation()} />, { session: staff });
    const user = userEvent.setup();
    const classification = await screen.findByRole('region', { name: 'Classification' });
    expect(classification).toHaveTextContent('Intent: Wants a quotation');
    expect(classification).toHaveTextContent('Priority: High');
    await user.click(within(classification).getByRole('button', { name: 'Set lead priority' }));
    const next = screen.getByRole('region', { name: 'Suggested next step' });
    expect(next).toHaveTextContent('Follow up on 2026-03-12');
    await user.click(within(next).getByRole('button', { name: 'Save as next step' }));
    await user.click(
      within(screen.getByRole('region', { name: 'Suggested note' })).getByRole('button', {
        name: 'Add as note',
      }),
    );
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(summary).toHaveTextContent('Wants a dining table.');
    expect(summary).toHaveTextContent('dining table');
    expect(within(summary).queryByRole('button')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/apply'))).toHaveLength(3),
    );
  });

  it('hides the lead buttons from someone who may not edit leads, and from conversations with no lead', async () => {
    mockApi({
      'GET /ai/status': () => status(),
      'GET /ai/conversations/c1/suggestions': () => [
        suggestion('CLASSIFICATION', { intent: 'ENQUIRY', priority: 'LOW' }),
      ],
    });
    const { unmount } = renderWithProviders(<AiPanel conversation={conversation()} />, {
      session: { permissions: ['ai:use'] },
    });
    const card = await screen.findByRole('region', { name: 'Classification' });
    expect(
      within(card).queryByRole('button', { name: 'Set lead priority' }),
    ).not.toBeInTheDocument();
    unmount();
    mockApi({
      'GET /ai/status': () => status(),
      'GET /ai/conversations/c1/suggestions': () => [
        suggestion('CLASSIFICATION', { intent: 'ENQUIRY', priority: 'LOW' }),
      ],
    });
    renderWithProviders(<AiPanel conversation={conversation({ leadId: null })} />, {
      session: staff,
    });
    expect(
      within(await screen.findByRole('region', { name: 'Classification' })).queryByRole('button', {
        name: 'Set lead priority',
      }),
    ).not.toBeInTheDocument();
  });
});

describe('AiSettings', () => {
  const owner = { permissions: ['ai:use', 'ai:control', 'ai:view_logs'] };

  it('shows usage, whether a service is connected and what is sent to it', async () => {
    mockApi({ 'GET /ai/status': () => status(), 'GET /ai/knowledge': () => [] });
    renderWithProviders(<AiSettings />, { session: owner });
    expect(await screen.findByText('Requests today: 12 of 500')).toBeInTheDocument();
    expect(screen.getByText('Tokens this month: 45000 of 2000000')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View the AI log' })).toHaveAttribute(
      'href',
      '/automation/log',
    );
    const data = screen
      .getByRole('heading', { name: 'What is sent to the AI service' })
      .closest('section') as HTMLElement;
    expect(
      within(data).getByText(/Never sent: passwords or keys, cost prices/),
    ).toBeInTheDocument();
    expect(within(data).getAllByRole('listitem')).toHaveLength(6);
  });

  it('offers Off and Assist only, and saves the settings', async () => {
    const { calls } = mockApi({
      'GET /ai/status': () => status({ mode: 'OFF' }),
      'GET /ai/knowledge': () => [],
      'PATCH /ai/settings': () => status({ mode: 'ASSIST' }),
    });
    renderWithProviders(<AiSettings />, { session: owner });
    const user = userEvent.setup();
    const mode = await screen.findByLabelText('Mode');
    expect(
      within(mode)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Off', 'Assist (suggestions for staff to review)']);
    await user.selectOptions(mode, 'ASSIST');
    await user.selectOptions(screen.getByLabelText('Tone'), 'FORMAL');
    const keywords = screen.getByLabelText('Escalation words');
    await user.clear(keywords);
    await user.type(keywords, 'refund, lawyer ,  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/ai/settings');
      expect(patch?.body).toMatchObject({
        mode: 'ASSIST',
        provider: 'ANTHROPIC',
        tone: 'FORMAL',
        replyLanguage: 'MATCH_CUSTOMER',
        maxReplyChars: 600,
        confidenceThreshold: 0.7,
        escalationKeywords: ['refund', 'lawyer'],
        contextMessageCount: 10,
        dailyRequestLimit: 500,
        monthlyTokenBudget: 2000000,
      });
    });
  });

  it('is read-only without ai:control: no form and no approved answers', async () => {
    mockApi({ 'GET /ai/status': () => status() });
    renderWithProviders(<AiSettings />, { session: { permissions: ['ai:use'] } });
    expect(await screen.findByText('Requests today: 12 of 500')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Approved answers' })).not.toBeInTheDocument();
  });

  it('adds, edits, switches off and deletes approved answers', async () => {
    const items = [
      {
        id: 'k1',
        title: 'Delivery',
        body: 'Within 3 weeks.',
        active: true,
        updatedAt: '2026-03-10T09:00:00.000Z',
      },
    ];
    const { calls } = mockApi({
      'GET /ai/status': () => status(),
      'GET /ai/knowledge': () => items,
      'POST /ai/knowledge': () => ({}),
      'PATCH /ai/knowledge/k1': () => ({}),
      'DELETE /ai/knowledge/k1': () => new Response(null, { status: 204 }),
    });
    renderWithProviders(<AiSettings />, { session: owner });
    const user = userEvent.setup();
    expect(await screen.findByText('Within 3 weeks.')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Active: Delivery'));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    const form = screen.getByRole('form', { name: 'New approved answer' });
    await user.type(within(form).getByLabelText('Title'), 'Returns');
    await user.type(within(form).getByLabelText('Text'), 'No returns on custom orders.');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Delivery' }));
    const edit = screen.getByRole('form', { name: 'Edit' });
    const body = within(edit).getByLabelText('Text');
    await user.clear(body);
    await user.type(body, 'Within 4 weeks.');
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Delete Delivery' }));
    await user.click(await screen.findByRole('button', { name: 'Delete', hidden: true }));
    await waitFor(() => {
      const sent = calls
        .filter((c) => c.path.startsWith('/ai/knowledge') && c.method !== 'GET')
        .map((c) => [c.method, c.path, c.body]);
      expect(sent).toEqual([
        ['PATCH', '/ai/knowledge/k1', { active: false }],
        ['POST', '/ai/knowledge', { title: 'Returns', body: 'No returns on custom orders.' }],
        ['PATCH', '/ai/knowledge/k1', { title: 'Delivery', body: 'Within 4 weeks.' }],
        ['DELETE', '/ai/knowledge/k1', undefined],
      ]);
    });
  });
});

describe('AiLog', () => {
  it('lists every AI action with its service, cost, result and approval', async () => {
    mockApi({
      'GET /ai/logs': () =>
        page(
          [
            {
              id: 'g1',
              conversationId: 'c1',
              actionType: 'DRAFT_REPLY',
              providerName: 'ANTHROPIC',
              modelVersion: 'claude-haiku-5-5',
              promptVersion: 'draft-reply.v1',
              inputTokens: 900,
              outputTokens: 120,
              latencyMs: 1800,
              confidenceScore: 0.9,
              outcome: 'SUCCESS',
              error: null,
              humanApproved: true,
              approvedAt: '2026-03-10T09:30:00.000Z',
              createdAt: '2026-03-10T09:00:00.000Z',
            },
            {
              id: 'g2',
              conversationId: 'c1',
              actionType: 'EXTRACT',
              providerName: 'NONE',
              modelVersion: null,
              promptVersion: 'extract.v1',
              inputTokens: 0,
              outputTokens: 0,
              latencyMs: null,
              confidenceScore: null,
              outcome: 'LIMIT_REACHED',
              error: 'DAILY_LIMIT',
              humanApproved: false,
              approvedAt: null,
              createdAt: '2026-03-10T08:00:00.000Z',
            },
          ],
          { nextCursor: 'more' },
        ),
    });
    renderWithProviders(<AiLog />, { session: { permissions: ['ai:view_logs'] } });
    await screen.findByText('DRAFT_REPLY');
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('DRAFT_REPLY');
    expect(rows[0]).toHaveTextContent('draft-reply.v1');
    expect(rows[0]).toHaveTextContent('claude-haiku-5-5');
    expect(rows[0]).toHaveTextContent('1020');
    expect(rows[0]).toHaveTextContent('1800 ms');
    expect(rows[0]).toHaveTextContent('Done');
    expect(rows[1]).toHaveTextContent('Not sent (limit reached)');
    expect(screen.getByRole('button', { name: 'Show older' })).toBeInTheDocument();
  });

  it('says so when there is nothing yet', async () => {
    mockApi({ 'GET /ai/logs': () => page([]) });
    renderWithProviders(<AiLog />, { session: { permissions: ['ai:view_logs'] } });
    expect(await screen.findByText('Nothing has been logged yet.')).toBeInTheDocument();
  });
});

describe('TemplatesManager', () => {
  const tpl = (over: Record<string, unknown>) => ({
    id: 't',
    name: 'T',
    kind: 'QUICK_REPLY',
    body: 'x',
    variables: [],
    providerName: null,
    language: null,
    providerStatus: null,
    active: true,
    ...over,
  });
  const manager = { permissions: ['template:view', 'template:configure'] };

  it('groups templates by kind and shows the provider approval status', async () => {
    mockApi({
      'GET /templates': () => [
        tpl({ id: 'a', name: 'Thanks', body: 'Thanks!' }),
        tpl({ id: 'b', name: 'Bank', kind: 'BANK_DETAILS', body: '{{bank_details}}' }),
        tpl({
          id: 'c',
          name: 'Follow up (en)',
          kind: 'PROVIDER',
          body: 'Hi {{1}}',
          providerStatus: 'PENDING',
          providerName: 'follow_up',
          language: 'en',
        }),
      ],
    });
    renderWithProviders(<TemplatesManager />, { session: manager });
    expect(await screen.findByRole('region', { name: 'Quick reply' })).toHaveTextContent('Thanks!');
    expect(screen.getByRole('region', { name: 'Bank details' })).toHaveTextContent(
      '{{bank_details}}',
    );
    expect(screen.getByRole('region', { name: 'Provider template' })).toHaveTextContent(
      'Waiting for approval',
    );
  });

  it("creates, edits and fetches templates, and shows the server's reason when one is refused", async () => {
    let create: unknown = { id: 'new' };
    const { calls } = mockApi({
      'GET /templates': () => [tpl({ id: 'a', name: 'Thanks', body: 'Thanks!' })],
      'POST /templates': () => (create instanceof Response ? create : create),
      'PATCH /templates/a': () => ({}),
      'POST /templates/sync': () => [],
    });
    renderWithProviders(<TemplatesManager />, { session: manager });
    const user = userEvent.setup();
    await screen.findByText('Thanks!');
    await user.click(screen.getByRole('button', { name: 'Add template' }));
    const form = screen.getByRole('form', { name: 'New template' });
    await user.type(within(form).getByLabelText('Name'), 'Balance');
    await user.selectOptions(within(form).getByLabelText('Kind'), 'MESSAGE');
    await user.click(within(form).getByLabelText('Text'));
    await user.paste('Dear {{customer_name}}, balance {{balance_due}}');
    create = failure(400, 'VALIDATION_FAILED', { body: ['uses unknown variables: nickname'] });
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('uses unknown variables: nickname');
    create = { id: 'new' };
    await user.click(
      within(screen.getByRole('form', { name: 'New template' })).getByRole('button', {
        name: 'Save',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Edit Thanks' }));
    const edit = screen.getByRole('form', { name: 'Edit template' });
    expect(within(edit).getByLabelText('Kind')).toBeDisabled();
    const body = within(edit).getByLabelText('Text');
    await user.clear(body);
    await user.type(body, 'Thank you!');
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    await user.click(await screen.findByRole('button', { name: 'Fetch approved templates' }));
    expect(await screen.findByText('Templates updated from the provider.')).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PATCH' && c.path === '/templates/a')?.body).toEqual({
        name: 'Thanks',
        body: 'Thank you!',
      });
    });
    expect(
      calls.filter((c) => c.method === 'POST' && c.path === '/templates').at(-1)?.body,
    ).toEqual({
      name: 'Balance',
      kind: 'MESSAGE',
      body: 'Dear {{customer_name}}, balance {{balance_due}}',
    });
  });

  it('is read-only without template:configure', async () => {
    mockApi({ 'GET /templates': () => [tpl({ id: 'a', name: 'Thanks', body: 'Thanks!' })] });
    renderWithProviders(<TemplatesManager />, { session: { permissions: ['template:view'] } });
    await screen.findByText('Thanks!');
    expect(screen.queryByRole('button', { name: 'Add template' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Thanks' })).not.toBeInTheDocument();
  });
});

describe('AutomationNav', () => {
  it('shows only the tabs the person may open', () => {
    renderWithProviders(<AutomationNav />, {
      session: { permissions: ['ai:use', 'template:view'] },
    });
    expect(screen.getByRole('link', { name: 'AI assistant' })).toHaveAttribute(
      'href',
      '/automation/ai',
    );
    expect(screen.getByRole('link', { name: 'Message templates' })).toHaveAttribute(
      'href',
      '/automation/templates',
    );
    expect(screen.queryByRole('link', { name: 'AI log' })).not.toBeInTheDocument();
  });
});
