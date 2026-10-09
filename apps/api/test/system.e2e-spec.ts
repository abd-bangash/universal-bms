import { DEFAULT_ROLES } from '@bms/types';
import { PasswordService } from '../src/modules/auth/password.service';
import { BackupStatusService } from '../src/modules/platform/backup-status.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, seedUser, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('System status (Requirement 51.6)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let owner: string;
  let manager: string;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
    const email = 'owner@system-status.test';
    const created = await t.app.get(TenantsService).createWorkspace({
      name: 'System Co',
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      country: 'PK',
    });
    owner = (await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200))
      .body.data.accessToken as string;
    const seeded = await seedUser(t.db.prisma, t.app.get(PasswordService), created.workspaceId, {
      email: 'manager@system-status.test',
      roleName: 'Manager copy',
      permissions: [...(DEFAULT_ROLES.find((r) => r.name === 'Manager')?.permissions ?? [])],
    });
    manager = (
      await http.post('/auth/login', { email: seeded.email, password: seeded.password }).expect(200)
    ).body.data.accessToken as string;
    await http
      .post(
        '/integrations',
        { provider: 'WHATSAPP', values: { phoneNumberId: '5550001', accessToken: 'tok' } },
        owner,
      )
      .expect(201);
  }, 90_000);
  afterAll(() => t.close());

  it('is for the Owner alone: no other default role holds system:view', () => {
    const holders = DEFAULT_ROLES.filter((r) => r.permissions.includes('system:view')).map(
      (r) => r.name,
    );
    expect(holders).toEqual(['Owner']);
  });

  it('shows services, integrations, queues and "no backup yet" before one is recorded', async () => {
    const res = (await http.get('/system/status', owner).expect(200)).body.data as Json;
    expect(res.services.length).toBeGreaterThan(0);
    expect(res.services.every((s: Json) => s.up === true)).toBe(true);
    expect(res.integrations).toEqual([
      expect.objectContaining({ provider: 'WHATSAPP', status: 'CONNECTED' }),
    ]);
    expect(JSON.stringify(res)).not.toContain('tok'); // credentials never leave the server
    expect(res.queues.map((q: Json) => q.name)).toEqual(
      expect.arrayContaining(['channel.inbound', 'ai.process']),
    );
    expect(res.deadLetters).toBe(0);
    expect(res.lastBackup).toBeNull();
  });

  it('shows the time of the last successful backup once the backup script reports it', async () => {
    await t.app
      .get(BackupStatusService)
      .record(new Date('2026-10-09T02:00:00Z'), 'nightly dump, 12 MB');
    const res = (await http.get('/system/status', owner).expect(200)).body.data as Json;
    expect(res.lastBackup).toEqual({
      at: '2026-10-09T02:00:00.000Z',
      note: 'nightly dump, 12 MB',
    });
  });

  it('refuses everyone else, a Manager included', async () => {
    await http.get('/system/status', manager).expect(403);
    await http.get('/system/status').expect(401);
  });
});
