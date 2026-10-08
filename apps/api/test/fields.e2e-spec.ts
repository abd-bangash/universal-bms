import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  parseCustomFieldFilters,
  customFieldConditions,
} from '../src/modules/fields/custom-field-filters';
import { FieldsService } from '../src/modules/fields/fields.service';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, type TestApp } from './helpers/auth-app';
import { runWithWorkspace } from './helpers/context';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

describe('Custom fields (real PostgreSQL)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let tenants: TenantsService;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
    http = api(app);
    tenants = app.get(TenantsService);
  }, 90_000);
  afterAll(() => t.close());

  async function business() {
    const email = `owner${++n}@fields.test`;
    const created = await tenants.createWorkspace({
      name: `Fields ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'Olivia', lastName: 'Owner', password: 'owner-password-1' },
    });
    const login = await http
      .post('/auth/login', { email, password: 'owner-password-1' })
      .expect(200);
    return { ...created, token: login.body.data.accessToken as string };
  }

  it('lists the profile definitions for any member, and keeps workspaces apart', async () => {
    const a = await business();
    const b = await business();
    const list = await http.get('/fields?entityType=ORDER_ITEM', a.token).expect(200);
    const keys = (list.body.data as Json[]).map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['size_type', 'length']));

    await http
      .post(
        '/fields',
        { entityType: 'CUSTOMER', key: 'only_a', label: 'Only A', type: 'TEXT' },
        a.token,
      )
      .expect(201);
    const forB = await http.get('/fields?entityType=CUSTOMER', b.token).expect(200);
    expect((forB.body.data as Json[]).map((f) => f.key)).not.toContain('only_a');
    const forA = await http.get('/fields?entityType=CUSTOMER', a.token).expect(200);
    expect((forA.body.data as Json[]).map((f) => f.key)).toContain('only_a');
    await http.get('/fields?entityType=NOPE', a.token).expect(400);
  });

  it('creates, validates the definition itself, and rejects duplicate keys', async () => {
    const b = await business();
    const post = (body: object) => http.post('/fields', body, b.token);
    const base = { entityType: 'PRODUCT', label: 'Wood', type: 'DROPDOWN' };

    await post({ ...base, key: 'wood' }).expect(400); // dropdown needs options
    await post({ ...base, key: 'Wood!', options: [{ key: 'a', label: 'A' }] }).expect(400);
    await post({
      ...base,
      key: 'wood',
      options: [
        { key: 'a', label: 'A' },
        { key: 'a', label: 'Again' },
      ],
    }).expect(400);
    await post({ ...base, key: 'size', type: 'MEASUREMENT' }).expect(400); // needs a dimension
    await post({ ...base, key: 'x', type: 'TEXT', options: [{ key: 'a', label: 'A' }] }).expect(
      400,
    );
    await post({
      ...base,
      key: 'cond',
      type: 'TEXT',
      visibleWhen: { source: 'nonsense', op: 'eq' },
    }).expect(400);

    const ok = await post({
      ...base,
      key: 'wood',
      options: [{ key: 'oak', label: 'Oak' }],
      visibleWhen: { source: 'productType', op: 'eq', value: 'STOCKABLE' },
    }).expect(201);
    expect(ok.body.data).toMatchObject({ key: 'wood', active: true, isSystem: false });
    await post({ ...base, key: 'wood', options: [{ key: 'oak', label: 'Oak' }] }).expect(400);
  });

  it('requires field:configure to change definitions', async () => {
    const b = await business();
    const roles = (await http.get('/roles', b.token).expect(200)).body.data as Json[];
    const viewer = roles.find((r) => r.name === 'Viewer') as Json;
    const invite = await http
      .post('/users/invite', { email: `v${n}@fields.test`, roleIds: [viewer.id] }, b.token)
      .expect(201);
    await http
      .post('/auth/invite/accept', {
        token: invite.body.data.token,
        password: 'viewer-password-1',
        firstName: 'V',
        lastName: 'V',
      })
      .expect(200);
    const login = await http
      .post('/auth/login', { email: `v${n}@fields.test`, password: 'viewer-password-1' })
      .expect(200);
    const token = login.body.data.accessToken as string;
    await http.get('/fields?entityType=PRODUCT', token).expect(200);
    await http
      .post('/fields', { entityType: 'PRODUCT', key: 'k', label: 'K', type: 'TEXT' }, token)
      .expect(403);
  });

  it('keeps the key and type fixed once a record uses them, and deactivates instead of deleting', async () => {
    const b = await business();
    const create = (key: string) =>
      http
        .post('/fields', { entityType: 'PRODUCT', key, label: key, type: 'TEXT' }, b.token)
        .expect(201);
    const unused = (await create('unused')).body.data as Json;
    const used = (await create('used_key')).body.data as Json;

    await http
      .patch(`/fields/${unused.id}`, { key: 'renamed', label: 'Renamed' }, b.token)
      .expect(200);
    await http.patch(`/fields/${unused.id}`, { type: 'NUMBER' }, b.token).expect(200);

    await t.db.prisma.product.create({
      data: {
        workspaceId: b.workspaceId,
        code: 'P1',
        name: 'Sofa',
        basePrice: '100',
        customFields: { used_key: 'hello' },
      },
    });
    const rename = await http.patch(`/fields/${used.id}`, { key: 'other' }, b.token).expect(400);
    expect(rename.body.details.key[0]).toMatch(/used/);
    await http.patch(`/fields/${used.id}`, { type: 'NUMBER' }, b.token).expect(400);
    // the label and the active flag are always editable
    await http.patch(`/fields/${used.id}`, { label: 'Nicer label' }, b.token).expect(200);
    const off = await http.patch(`/fields/${used.id}`, { active: false }, b.token).expect(200);
    expect(off.body.data.active).toBe(false);

    const active = await http.get('/fields?entityType=PRODUCT', b.token).expect(200);
    expect((active.body.data as Json[]).map((f) => f.key)).not.toContain('used_key');
    const all = await http
      .get('/fields?entityType=PRODUCT&includeInactive=true', b.token)
      .expect(200);
    expect((all.body.data as Json[]).map((f) => f.key)).toContain('used_key');
    await http.patch('/fields/missing', { label: 'x' }, b.token).expect(404);
  });

  it('another workspace cannot read or change a definition', async () => {
    const a = await business();
    const b = await business();
    const field = (
      await http
        .post('/fields', { entityType: 'LEAD', key: 'mine', label: 'Mine', type: 'TEXT' }, a.token)
        .expect(201)
    ).body.data as Json;
    await http.patch(`/fields/${field.id}`, { label: 'Hacked' }, b.token).expect(404);
  });

  it('validates record values with the shared engine, with field-level errors (26.3)', async () => {
    const b = await business();
    const fields = app.get(FieldsService);
    const run = <T>(work: () => Promise<T>) => runWithWorkspace(app, b.workspaceId, work);

    const ok = await run(() =>
      fields.validate('ORDER_ITEM', {
        size_type: 'custom',
        length: { value: 6.5, unit: 'ft' },
      }),
    );
    expect(ok).toMatchObject({ size_type: 'custom', length: { value: '6.5', unit: 'ft' } });

    await expect(
      run(() => fields.validate('ORDER_ITEM', { size_type: 'huge', nope: 1 })),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        'customFields.size_type': expect.any(Array),
        'customFields.nope': ['is not a defined field'],
      },
    });
    // unit must be a known unit of the right dimension
    await expect(
      run(() =>
        fields.validate('ORDER_ITEM', { size_type: 'custom', length: { value: '1', unit: 'kg' } }),
      ),
    ).rejects.toMatchObject({ details: { 'customFields.length': expect.any(Array) } });

    const snapshot = await run(() => fields.snapshot('ORDER_ITEM', ok));
    expect(snapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'size_type', value: 'Custom' }),
        expect.objectContaining({ key: 'length', value: '6.5', unit: 'ft' }),
      ]),
    );
  });

  it('turns ?cf.<key> filters into JSONB queries (26.7)', async () => {
    const b = await business();
    const fields = app.get(FieldsService);
    const mk = (workspaceId: string, code: string, customFields: object) =>
      t.db.prisma.product.create({
        data: { workspaceId, code, name: code, basePrice: '1', customFields },
      });
    await mk(b.workspaceId, 'A', {
      wood: 'oak',
      weight_kg: '10',
      delivered: '2024-03-10',
      w: { value: '5', unit: 'ft' },
      ok: true,
      tags: ['x', 'y'],
    });
    await mk(b.workspaceId, 'B', {
      wood: 'teak',
      weight_kg: '25.5',
      delivered: '2024-06-01',
      w: { value: '8', unit: 'ft' },
      ok: false,
      tags: ['y'],
    });
    await mk(b.workspaceId, 'C', { wood: 'oak', weight_kg: '3' });

    const defs = [
      {
        key: 'wood',
        label: 'W',
        type: 'DROPDOWN',
        options: [
          { key: 'oak', label: 'Oak' },
          { key: 'teak', label: 'Teak' },
        ],
      },
      { key: 'weight_kg', label: 'Wt', type: 'NUMBER' },
      { key: 'delivered', label: 'D', type: 'DATE' },
      { key: 'w', label: 'Width', type: 'MEASUREMENT' },
      { key: 'ok', label: 'Ok', type: 'BOOLEAN' },
      {
        key: 'tags',
        label: 'Tags',
        type: 'MULTI_SELECT',
        options: [
          { key: 'x', label: 'X' },
          { key: 'y', label: 'Y' },
        ],
      },
      { key: 'note', label: 'N', type: 'TEXT' },
    ] as const;
    const codes = async (query: Record<string, string>) => {
      const filters = parseCustomFieldFilters(query, defs as never);
      const conditions = customFieldConditions(filters, '"custom_fields"');
      const where = conditions.length
        ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;
      const rows = await runWithWorkspace(
        app,
        b.workspaceId,
        () =>
          t.db.prisma.$queryRaw<Array<{ code: string }>>`
          SELECT code FROM products WHERE workspace_id = ${b.workspaceId} ${where} ORDER BY code`,
      );
      return rows.map((r) => r.code);
    };

    expect(await codes({ 'cf.wood': 'oak' })).toEqual(['A', 'C']);
    expect(await codes({ 'cf.wood': 'oak', 'cf.ok': 'true' })).toEqual(['A']);
    expect(await codes({ 'cf.tags': 'y' })).toEqual(['A', 'B']);
    expect(await codes({ 'cf.tags': 'x' })).toEqual(['A']);
    expect(await codes({ 'cf.weight_kg.gte': '10', 'cf.weight_kg.lte': '25.5' })).toEqual([
      'A',
      'B',
    ]);
    expect(await codes({ 'cf.weight_kg.gte': '9' })).toEqual(['A', 'B']);
    expect(await codes({ 'cf.delivered.gte': '2024-05-01' })).toEqual(['B']);
    expect(await codes({ 'cf.w.lte': '6' })).toEqual(['A']);
    expect(await codes({ 'cf.w': '8' })).toEqual(['B']);
    expect(await codes({})).toEqual(['A', 'B', 'C']);

    expect(() => parseCustomFieldFilters({ 'cf.unknown': 'x' }, defs as never)).toThrow();
    expect(() => parseCustomFieldFilters({ 'cf.wood': 'pine' }, defs as never)).toThrow();
    expect(() => parseCustomFieldFilters({ 'cf.wood.gte': 'a' }, defs as never)).toThrow();
    expect(() => parseCustomFieldFilters({ 'cf.weight_kg.gte': 'abc' }, defs as never)).toThrow();
    expect(() => parseCustomFieldFilters({ 'cf.note.gte': '1' }, defs as never)).toThrow();
    // injection attempts are values, never SQL
    expect(await codes({ 'cf.note': "x'; DROP TABLE products; --" })).toEqual([]);
    expect(fields).toBeDefined();
  });
});
