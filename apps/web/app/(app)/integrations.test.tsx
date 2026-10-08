import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderWithProviders } from '@/test/render';
import { IntegrationsManager } from './integrations/integrations-manager';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/integrations',
}));

const providers = [
  {
    provider: 'WHATSAPP',
    type: 'CHANNEL',
    label: 'WhatsApp Business',
    fields: [
      { key: 'phoneNumberId', label: 'Phone number id', secret: false, required: true },
      { key: 'accessToken', label: 'Access token', secret: true, required: true },
    ],
  },
];
const connection = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  provider: 'WHATSAPP',
  providerLabel: 'WhatsApp Business',
  type: 'CHANNEL',
  status: 'CONNECTED',
  displayName: 'Showroom line',
  externalAccountId: '1055',
  lastSuccessAt: '2026-03-10T09:00:00.000Z',
  lastErrorAt: null,
  lastError: null,
  fields: [
    { key: 'phoneNumberId', label: 'Phone number id', secret: false, value: '1055' },
    { key: 'accessToken', label: 'Access token', secret: true, value: '••••9876' },
  ],
  ...over,
});
const owner = { permissions: ['integration:view', 'integration:manage'] };

describe('IntegrationsManager', () => {
  it('shows each connection with its status, last success, last problem and masked credentials', async () => {
    mockApi({
      'GET /integrations': () => ({
        providers,
        connections: [
          connection(),
          connection({
            id: 'c2',
            displayName: 'Broken',
            status: 'ERROR',
            lastErrorAt: '2026-03-10T10:00:00.000Z',
            lastError: 'AUTH_FAILED',
          }),
        ],
      }),
    });
    renderWithProviders(<IntegrationsManager />, { session: owner });
    expect(await screen.findByText('Showroom line')).toBeInTheDocument();
    expect(screen.getAllByText('••••9876')).toHaveLength(2);
    expect(screen.getByText('Problem')).toBeInTheDocument();
    expect(screen.getByText(/The credentials were refused/)).toBeInTheDocument();
    expect(screen.queryByText(/EAAG/)).not.toBeInTheDocument();
  });

  it('tests a connection and shows the answer, success or a plain failure', async () => {
    let ok = true;
    const { calls } = mockApi({
      'GET /integrations': () => ({ providers, connections: [connection()] }),
      'POST /integrations/c1/test': () =>
        ok ? { ok: true, detail: 'Verified +92 300 1234567' } : { ok: false, code: 'TIMEOUT' },
    });
    renderWithProviders(<IntegrationsManager />, { session: owner });
    await userEvent.click(await screen.findByRole('button', { name: 'Test Showroom line' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The connection works. Verified +92 300 1234567',
    );
    ok = false;
    await userEvent.click(screen.getByRole('button', { name: 'Test Showroom line' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The test failed: The service did not answer in time.',
      ),
    );
    expect(calls.filter((c) => c.path === '/integrations/c1/test')).toHaveLength(2);
  });

  it('connects a provider: secret fields are password inputs and the values are sent once', async () => {
    const { calls } = mockApi({
      'GET /integrations': () => ({ providers, connections: [] }),
      'POST /integrations': () => connection(),
    });
    renderWithProviders(<IntegrationsManager />, { session: owner });
    await userEvent.click(await screen.findByRole('button', { name: 'Connect WhatsApp Business' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Access token/)).toHaveAttribute('type', 'password');
    await userEvent.type(within(dialog).getByLabelText(/Phone number id/), '1055');
    await userEvent.type(within(dialog).getByLabelText(/Access token/), 'EAAG-secret');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/integrations')?.body).toEqual({
        provider: 'WHATSAPP',
        values: { phoneNumberId: '1055', accessToken: 'EAAG-secret' },
      }),
    );
  });

  it('shows field errors from the server', async () => {
    mockApi({
      'GET /integrations': () => ({ providers, connections: [] }),
      'POST /integrations': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    renderWithProviders(<IntegrationsManager />, { session: owner });
    await userEvent.click(await screen.findByRole('button', { name: 'Connect WhatsApp Business' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  });

  it('asks before disconnecting', async () => {
    const { calls } = mockApi({
      'GET /integrations': () => ({ providers, connections: [connection()] }),
      'POST /integrations/c1/disconnect': () => connection({ status: 'DISCONNECTED' }),
    });
    renderWithProviders(<IntegrationsManager />, { session: owner });
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Showroom line' }));
    expect(calls.some((c) => c.path.endsWith('/disconnect'))).toBe(false);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/integrations/c1/disconnect')).toBe(true),
    );
  });

  it('read-only for people who can view but not manage', async () => {
    mockApi({ 'GET /integrations': () => ({ providers, connections: [connection()] }) });
    renderWithProviders(<IntegrationsManager />, {
      session: { permissions: ['integration:view'] },
    });
    expect(await screen.findByText('Showroom line')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Test|Disconnect|Connect/ }),
    ).not.toBeInTheDocument();
  });
});
