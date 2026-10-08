import sharp from 'sharp';
import request from 'supertest';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Expenses API (real PostgreSQL)', () => {
  let t: TestApp;
  let http: ReturnType<typeof api>;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    http = api(t.app);
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@exp.test`;
    const created = await t.app.get(TenantsService).createWorkspace({
      name: `Exp ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'O', password: 'owner-password-1' },
      currency: 'PKR',
    });
    const token = (
      await http.post('/auth/login', { email, password: 'owner-password-1' }).expect(200)
    ).body.data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const categories = (await http.get('/settings/expense-categories', token).expect(200)).body
      .data as Json[];
    const methods = (await http.get('/settings/payment-methods', token)).body.data as Json[];
    return {
      ...created,
      token,
      roles,
      rent: categories.find((c) => c.name === 'Rent')?.id as string,
      materials: categories.find((c) => c.name === 'Raw materials')?.id as string,
      cash: methods.find((m) => m.name === 'Cash') as Json,
    };
  }
  type Biz = Awaited<ReturnType<typeof business>>;

  async function member(b: Biz, roleName: string) {
    const email = `${roleName.toLowerCase().replace(/\W/g, '')}${++n}@exp.test`;
    const role = b.roles.find((r) => r.name === roleName) as Json;
    const invite = await http
      .post('/users/invite', { email, roleIds: [role.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'member-password-1',
        firstName: roleName,
        lastName: 'P',
      })
      .expect(200);
    return {
      token: (await http.post('/auth/login', { email, password: 'member-password-1' }).expect(200))
        .body.data.accessToken as string,
    };
  }

  const create = (b: { token: string }, body: object) => http.post('/expenses', body, b.token);

  it('has the profile categories, and categories can be added, renamed and switched off', async () => {
    const b = await business();
    const list = (await http.get('/settings/expense-categories', b.token)).body.data as Json[];
    expect(list.map((c) => c.name)).toEqual(expect.arrayContaining(['Rent', 'Utilities', 'Other']));
    const cat = (
      await http.post('/settings/expense-categories', { name: 'Packaging' }, b.token).expect(201)
    ).body.data as Json;
    await http.post('/settings/expense-categories', { name: 'packaging' }, b.token).expect(400);
    await http
      .patch(`/settings/expense-categories/${cat.id}`, { name: 'Packing' }, b.token)
      .expect(200);
    await http
      .patch(`/settings/expense-categories/${cat.id}`, { active: false }, b.token)
      .expect(200);
    expect(
      ((await http.get('/settings/expense-categories', b.token)).body.data as Json[]).some(
        (c) => c.id === cat.id,
      ),
    ).toBe(false);
    expect(
      (
        (await http.get('/settings/expense-categories?includeInactive=true', b.token)).body
          .data as Json[]
      ).some((c) => c.id === cat.id),
    ).toBe(true);
    await create(b, {
      categoryId: cat.id,
      amount: '10',
      expenseDate: '2026-03-01',
      paymentMethodId: b.cash.id,
    }).expect(400); // inactive
    const viewer = await member(b, 'Viewer');
    await http.get('/settings/expense-categories', viewer.token).expect(403);
  });

  it('records an expense into the method’s account, with an attachment and custom fields', async () => {
    const b = await business();
    const png = await sharp({
      create: { width: 30, height: 30, channels: 3, background: '#445566' },
    })
      .png()
      .toBuffer();
    const upload = await request(t.app.getHttpServer())
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Forwarded-For', '10.33.0.1')
      .attach('file', png, { filename: 'bill.png', contentType: 'image/png' })
      .expect(201);
    const res = await create(b, {
      categoryId: b.rent,
      amount: '45000.50',
      expenseDate: '2026-03-01',
      paymentMethodId: b.cash.id,
      description: 'March shop rent',
      attachmentFileId: upload.body.data.id,
    }).expect(201);
    expect(res.body.data).toMatchObject({
      status: 'POSTED',
      amount: '45000.5',
      accountId: b.cash.accountId,
      description: 'March shop rent',
      attachmentFileId: upload.body.data.id,
    });
    const file = await t.db.prisma.fileAsset.findFirstOrThrow({
      where: { id: upload.body.data.id },
    });
    expect(file).toMatchObject({ entityType: 'EXPENSE', entityId: res.body.data.id });
    const audit = await t.db.prisma.auditEvent.findFirst({
      where: { workspaceId: b.workspaceId, action: 'expense.create' },
    });
    expect(audit).not.toBeNull();
  });

  it('validates amount, category, method and custom fields', async () => {
    const b = await business();
    const ok = {
      categoryId: b.rent,
      amount: '10',
      expenseDate: '2026-03-01',
      paymentMethodId: b.cash.id,
    };
    await create(b, { ...ok, amount: '0' }).expect(400);
    await create(b, { ...ok, amount: 'abc' }).expect(400);
    await create(b, { ...ok, categoryId: 'nope' }).expect(400);
    await create(b, { ...ok, paymentMethodId: 'nope' }).expect(400);
    await create(b, { ...ok, expenseDate: 'yesterday' }).expect(400);
    await create(b, { ...ok, attachmentFileId: 'nope' }).expect(400);
    await http
      .post(
        '/fields',
        {
          entityType: 'EXPENSE',
          key: 'invoice_no',
          label: 'Invoice no.',
          type: 'TEXT',
          required: true,
        },
        b.token,
      )
      .expect(201);
    await create(b, ok).expect(400);
    await create(b, { ...ok, customFields: { invoice_no: 'A-17' } }).expect(201);
  });

  it('voiding needs a reason, keeps the record, and is audited; a posted expense cannot be edited', async () => {
    const b = await business();
    const e = (
      await create(b, {
        categoryId: b.rent,
        amount: '100',
        expenseDate: '2026-03-01',
        paymentMethodId: b.cash.id,
      }).expect(201)
    ).body.data as Json;
    await http.post(`/expenses/${e.id}/void`, {}, b.token).expect(400);
    const voided = await http
      .post(`/expenses/${e.id}/void`, { reason: 'Entered twice' }, b.token)
      .expect(200);
    expect(voided.body.data).toMatchObject({ status: 'VOIDED', voidReason: 'Entered twice' });
    await http.post(`/expenses/${e.id}/void`, { reason: 'again' }, b.token).expect(422);
    await http.patch(`/expenses/${e.id}`, { amount: '1' }, b.token).expect(404); // there is no edit endpoint
    const events = await t.db.prisma.auditEvent.findMany({
      where: { workspaceId: b.workspaceId, entityId: e.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((x) => x.action)).toEqual(['expense.create', 'expense.void']);
  });

  it('lists with date, category and status filters and cursor paging', async () => {
    const b = await business();
    for (const [date, cat, amount] of [
      ['2026-01-10', b.rent, '10'],
      ['2026-02-10', b.rent, '20'],
      ['2026-03-10', b.materials, '30'],
    ] as const) {
      await create(b, {
        categoryId: cat,
        amount,
        expenseDate: date,
        paymentMethodId: b.cash.id,
      }).expect(201);
    }
    const all = (await http.get('/expenses?limit=2', b.token).expect(200)).body as Json;
    expect(all.data.map((e: Json) => e.amount)).toEqual(['30', '20']);
    const next = (await http.get(`/expenses?limit=2&cursor=${all.meta.nextCursor}`, b.token))
      .body as Json;
    expect(next.data.map((e: Json) => e.amount)).toEqual(['10']);
    expect(
      ((await http.get(`/expenses?categoryId=${b.materials}`, b.token)).body.data as Json[]).map(
        (e) => e.amount,
      ),
    ).toEqual(['30']);
    expect(
      (
        (await http.get('/expenses?from=2026-02-01&to=2026-02-28', b.token)).body.data as Json[]
      ).map((e) => e.amount),
    ).toEqual(['20']);
    expect((await http.get('/expenses?status=VOIDED', b.token)).body.data as Json[]).toEqual([]);
  });

  it('enforces permissions and keeps workspaces apart', async () => {
    const a = await business();
    const other = await business();
    const e = (
      await create(a, {
        categoryId: a.rent,
        amount: '10',
        expenseDate: '2026-03-01',
        paymentMethodId: a.cash.id,
      }).expect(201)
    ).body.data as Json;
    const sales = await member(a, 'Salesperson');
    await http.get('/expenses', sales.token).expect(403);
    await create(sales, {
      categoryId: a.rent,
      amount: '10',
      expenseDate: '2026-03-01',
      paymentMethodId: a.cash.id,
    }).expect(403);
    const staff = await member(a, 'Account Staff');
    await http.get('/expenses', staff.token).expect(200);
    await http.get(`/expenses/${e.id}`, other.token).expect(404);
    await http.post(`/expenses/${e.id}/void`, { reason: 'x' }, other.token).expect(404);
    await create(other, {
      categoryId: a.rent,
      amount: '10',
      expenseDate: '2026-03-01',
      paymentMethodId: other.cash.id,
    }).expect(400);
    await create(other, {
      categoryId: other.rent,
      amount: '10',
      expenseDate: '2026-03-01',
      paymentMethodId: a.cash.id,
    }).expect(400);
    expect((await http.get('/expenses', other.token)).body.data as Json[]).toEqual([]);
  });
});
