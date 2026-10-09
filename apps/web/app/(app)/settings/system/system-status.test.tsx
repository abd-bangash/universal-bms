import { screen } from '@testing-library/react';
import { failure, mockApi, renderWithProviders } from '@/test/render';
import { SystemStatusView } from './system-status';
import type { SystemStatus } from '@/lib/hooks/use-system';

const owner = { permissions: ['system:view'] };

const status = (over: Partial<SystemStatus> = {}): SystemStatus => ({
  checkedAt: '2026-10-09T10:00:00.000Z',
  services: [
    { name: 'database', up: true },
    { name: 'redis', up: false },
  ],
  integrations: [
    {
      provider: 'WHATSAPP',
      type: 'CHANNEL',
      status: 'ERROR',
      lastSuccessAt: null,
      lastErrorAt: '2026-10-09T09:00:00.000Z',
      lastError: 'token expired',
    },
  ],
  queues: [{ name: 'ai.process', waiting: 2, active: 1, delayed: 0, failed: 3 }],
  deadLetters: 4,
  lastBackup: null,
  ...over,
});

describe('SystemStatusView', () => {
  it('shows services, the integration with its last error, queues and the dead-letter count', async () => {
    mockApi({ 'GET /system/status': () => status() });
    renderWithProviders(<SystemStatusView />, { session: owner });
    expect(await screen.findByText('Not responding')).toBeInTheDocument();
    expect(screen.getByText('Working')).toBeInTheDocument();
    expect(screen.getByText('WHATSAPP')).toBeInTheDocument();
    expect(screen.getByText(/token expired/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /ai\.process 2 1 0 3/ })).toBeInTheDocument();
    expect(screen.getByText('Jobs given up on: 4')).toBeInTheDocument();
  });

  it('says plainly when no backup has been recorded', async () => {
    mockApi({ 'GET /system/status': () => status() });
    renderWithProviders(<SystemStatusView />, { session: owner });
    expect(await screen.findByText(/No backup has been recorded yet/)).toBeInTheDocument();
  });

  it('shows the last backup, and warns when it is more than a day old', async () => {
    mockApi({
      'GET /system/status': () =>
        status({ lastBackup: { at: '2020-01-01T02:00:00.000Z', note: 'nightly dump' } }),
    });
    renderWithProviders(<SystemStatusView />, { session: owner });
    expect(await screen.findByText(/Last successful backup: .*nightly dump/)).toBeInTheDocument();
    expect(screen.getByText('The last backup is more than 24 hours old.')).toBeInTheDocument();
  });

  it('shows the error when the status cannot be loaded', async () => {
    mockApi({ 'GET /system/status': () => failure(403, 'PERMISSION_DENIED') });
    renderWithProviders(<SystemStatusView />, { session: owner });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
