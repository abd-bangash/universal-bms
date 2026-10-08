import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { FilesService } from '../src/modules/files/files.service';
import { FileReferenceRegistry } from '../src/modules/files/file-reference.registry';
import { createStorage } from '../src/modules/files/files.module';
import { LocalDiskStorage } from '../src/modules/files/storage/local-disk.storage';
import { S3Storage } from '../src/modules/files/storage/s3.storage';
import { STORAGE } from '../src/modules/files/storage/storage.token';
import { ReadinessRegistry } from '../src/modules/health/readiness';
import { TenantsService } from '../src/modules/tenants/tenants.service';
import { api, createTestApp, testEnv, type TestApp } from './helpers/auth-app';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies

const png = (width = 1200, height = 600) =>
  sharp({ create: { width, height, channels: 3, background: '#aa5522' } })
    .png()
    .toBuffer();
const jpeg = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: '#2255aa' } })
    .jpeg()
    .toBuffer();
const webp = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: '#22aa55' } })
    .webp()
    .toBuffer();
const pdf = () => Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

describe('File storage (real PostgreSQL, local-disk driver)', () => {
  let t: TestApp;
  let app: INestApplication;
  let http: ReturnType<typeof api>;
  let tenants: TenantsService;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp({ MAX_UPLOAD_MB: 1 });
    app = t.app;
    http = api(app);
    tenants = app.get(TenantsService);
  }, 90_000);
  afterAll(async () => {
    await t.close();
    await rm(resolve(process.cwd(), '.local-storage'), { recursive: true, force: true });
  });

  const prisma = () => t.db.prisma;
  const storage = () => app.get<LocalDiskStorage>(STORAGE);

  async function business() {
    n += 1;
    const email = `owner${n}@files.test`;
    const created = await tenants.createWorkspace({
      name: `Files Co ${n}`,
      industryProfile: 'furniture',
      owner: { email, firstName: 'O', lastName: 'W', password: 'owner-password-1' },
    });
    const token = (await http.post('/auth/login', { email, password: 'owner-password-1' })).body
      .data.accessToken as string;
    const roles = (await http.get('/roles', token)).body.data as Json[];
    const member = async (roleName: string, address: string) => {
      const role = roles.find((r) => r.name === roleName) as Json;
      const inv = await http
        .post('/users/invite', { email: address, roleIds: [role.id] }, token)
        .expect(201);
      await http
        .post('/auth/invite/accept', {
          token: inv.body.data.token,
          password: 'member-password-1',
          firstName: 'M',
          lastName: 'M',
        })
        .expect(200);
      return (await http.post('/auth/login', { email: address, password: 'member-password-1' }))
        .body.data.accessToken as string;
    };
    return { ...created, token, member };
  }

  /** multipart upload through the real HTTP stack */
  const upload = (
    token: string,
    content: Buffer | undefined,
    options: { filename?: string; contentType?: string; fields?: Record<string, string> } = {},
  ) => {
    const req = request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', `10.7.${n}.${Math.floor(Math.random() * 250)}`);
    for (const [k, v] of Object.entries(options.fields ?? {})) req.field(k, v);
    if (content)
      req.attach('file', content, {
        filename: options.filename ?? 'file.png',
        contentType: options.contentType ?? 'application/octet-stream',
      });
    return req;
  };

  const countFiles = (workspaceId: string) => prisma().fileAsset.count({ where: { workspaceId } });

  describe('upload (Requirements 34.1, 34.5, 34.7)', () => {
    it('stores an image privately with a File_Asset, a 400px thumbnail and an audit event', async () => {
      const b = await business();
      const res = await upload(b.token, await png(1200, 600), {
        filename: 'sofa front.png',
        contentType: 'image/png',
        fields: { entityType: 'PRODUCT', entityId: 'prod_1', purpose: 'image' },
      }).expect(201);
      const dto = res.body.data;
      expect(dto).toMatchObject({
        name: 'sofa front.png',
        mime: 'image/png',
        entityType: 'PRODUCT',
        entityId: 'prod_1',
        purpose: 'image',
        hasThumbnail: true,
      });
      expect(dto.size).toBeGreaterThan(0);

      const row = await prisma().fileAsset.findUniqueOrThrow({ where: { id: dto.id } });
      expect(row.workspaceId).toBe(b.workspaceId);
      expect(row.storageKey).toMatch(
        new RegExp(`^ws/${b.workspaceId}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.png$`),
      );
      expect(row.thumbnailKey).toMatch(/\.thumb\.webp$/);
      expect(row.uploadedById).toBeTruthy();
      expect(await storage().head(row.storageKey)).toMatchObject({ mime: 'image/png' });

      const thumb = await sharp(
        (
          await storage().readSigned(
            ...parseSigned(await storage().getSignedUrl(row.thumbnailKey as string, 60)),
          )
        )?.body,
      ).metadata();
      expect(thumb.format).toBe('webp');
      expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBe(400);
      expect(thumb.width).toBe(400);
      expect(thumb.height).toBe(200); // aspect ratio kept

      expect(
        await prisma().auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'file.upload', entityId: dto.id },
        }),
      ).toBe(1);
      expect(JSON.stringify(res.body)).not.toContain('storageKey');
    });

    it('does not enlarge small images, and accepts JPEG, WebP and PDF (PDF has no thumbnail)', async () => {
      const b = await business();
      const small = (await upload(b.token, await jpeg(), { filename: 'a.jpg' }).expect(201)).body
        .data;
      expect(small).toMatchObject({ mime: 'image/jpeg', hasThumbnail: true });
      const row = await prisma().fileAsset.findUniqueOrThrow({ where: { id: small.id } });
      expect(row.storageKey).toMatch(/\.jpg$/);
      const meta = await sharp(
        (
          await storage().readSigned(
            ...parseSigned(await storage().getSignedUrl(row.thumbnailKey as string, 60)),
          )
        )?.body,
      ).metadata();
      expect(meta.width).toBe(64);

      expect(
        (await upload(b.token, await webp(), { filename: 'a.webp' }).expect(201)).body.data.mime,
      ).toBe('image/webp');
      const doc = (await upload(b.token, pdf(), { filename: 'quote.pdf' }).expect(201)).body.data;
      expect(doc).toMatchObject({ mime: 'application/pdf', hasThumbnail: false });
    });

    it('records the real type when the name or declared type lie, and cleans the name', async () => {
      const b = await business();
      const res = await upload(b.token, await png(40, 40), {
        filename: '..\\..\\evil.pdf',
        contentType: 'application/pdf',
      }).expect(201);
      expect(res.body.data).toMatchObject({ mime: 'image/png', name: 'evil.pdf' });
      const row = await prisma().fileAsset.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(row.storageKey.endsWith('.png')).toBe(true);
    });
  });

  describe('Requirement 34.2 — type is decided from the content (task 12.1)', () => {
    it.each([
      [
        'HTML named .jpg',
        Buffer.from('<html><script>alert(1)</script></html>'),
        'photo.jpg',
        'image/jpeg',
      ],
      [
        'SVG with script named .png',
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
        'logo.png',
        'image/png',
      ],
      [
        'executable named .pdf',
        Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0]),
        'invoice.pdf',
        'application/pdf',
      ],
      ['shell script named .webp', Buffer.from('#!/bin/sh\nrm -rf /\n'), 'pic.webp', 'image/webp'],
      ['GIF', Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'), 'anim.gif', 'image/gif'],
      ['zip named .jpg', Buffer.from('PK\u0003\u0004data'), 'a.jpg', 'image/jpeg'],
    ])('rejects %s and stores nothing', async (_label, content, filename, contentType) => {
      const b = await business();
      const res = await upload(b.token, content, { filename, contentType }).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(res.body.details.file[0]).toMatch(/unsupported file type/);
      expect(await countFiles(b.workspaceId)).toBe(0);
    });

    it('rejects an image that cannot be decoded', async () => {
      const b = await business();
      const broken = Buffer.concat([(await png(10, 10)).subarray(0, 40), Buffer.alloc(200, 7)]);
      const res = await upload(b.token, broken, { filename: 'broken.png' }).expect(400);
      expect(res.body.details.file).toEqual(['is not a valid image']);
      expect(await countFiles(b.workspaceId)).toBe(0);
    });

    it('accepts CSV only as an import', async () => {
      const b = await business();
      const csv = Buffer.from('sku,name\nA1,Chair\n');
      await upload(b.token, csv, { filename: 'products.csv', contentType: 'text/csv' }).expect(400);
      const ok = await upload(b.token, csv, {
        filename: 'products.csv',
        fields: { entityType: 'IMPORT', entityId: 'job_1', purpose: 'attachment' },
      }).expect(201);
      expect(ok.body.data.mime).toBe('text/csv');
      await upload(b.token, Buffer.from([1, 2, 3, 0, 4]), {
        filename: 'x.csv',
        fields: { entityType: 'IMPORT', entityId: 'job_1' },
      }).expect(400);
    });

    it('requires an image where the purpose says image or reference', async () => {
      const b = await business();
      const res = await upload(b.token, pdf(), {
        filename: 'a.pdf',
        fields: { purpose: 'image' },
      }).expect(400);
      expect(res.body.details.file[0]).toMatch(/must be an image/);
      await upload(b.token, pdf(), { filename: 'a.pdf', fields: { purpose: 'attachment' } }).expect(
        201,
      );
    });
  });

  describe('Requirement 34.3 — size limit', () => {
    it('rejects files over the limit with 413 FILE_TOO_LARGE and stores nothing', async () => {
      const b = await business();
      const big = Buffer.concat([await png(10, 10), Buffer.alloc(1024 * 1024 + 10, 1)]);
      const res = await upload(b.token, big, { filename: 'huge.png' }).expect(413);
      expect(res.body).toMatchObject({ statusCode: 413, code: 'FILE_TOO_LARGE' });
      expect(await countFiles(b.workspaceId)).toBe(0);
    });

    it('accepts a file just under the limit', async () => {
      const b = await business();
      const almost = Buffer.concat([pdf(), Buffer.alloc(1024 * 1024 - 1000, 32)]);
      await upload(b.token, almost, { filename: 'big.pdf' }).expect(201);
    });
  });

  describe('request validation and permissions', () => {
    it('needs a file and consistent link fields', async () => {
      const b = await business();
      expect((await upload(b.token, undefined, {}).expect(400)).body.details.file).toEqual([
        'is required',
      ]);
      await upload(b.token, await png(10, 10), { fields: { entityType: 'PRODUCT' } }).expect(400);
      await upload(b.token, await png(10, 10), { fields: { entityId: 'x' } }).expect(400);
      await upload(b.token, await png(10, 10), {
        fields: { entityType: 'UNICORN', entityId: 'x' },
      }).expect(400);
      await upload(b.token, await png(10, 10), { fields: { purpose: 'selfie' } }).expect(400);
      await upload(b.token, await png(10, 10), { fields: { surprise: '1' } }).expect(400);
      await request(app.getHttpServer())
        .post('/api/v1/files')
        .attach('file', await png(10, 10), 'a.png')
        .expect(401);
    });

    it('attaching to a record needs the permission to edit that kind of record', async () => {
      const b = await business();
      const cashier = await b.member('Cashier', 'cashier@files.test');
      const denied = await upload(cashier, await png(10, 10), {
        fields: { entityType: 'PRODUCT', entityId: 'p1' },
      }).expect(403);
      expect(denied.body.code).toBe('PERMISSION_DENIED');
      await upload(cashier, await png(10, 10), {
        fields: { entityType: 'PAYMENT', entityId: 'pay1', purpose: 'proof' },
      }).expect(201);
      await upload(cashier, await png(10, 10)).expect(201); // unattached uploads are open to any member
    });
  });

  describe('signed URLs (Requirement 34.4)', () => {
    it('issues a five-minute URL that serves the file, and refuses a tampered or expired one', async () => {
      const b = await business();
      const file = (
        await upload(b.token, await png(300, 100), {
          filename: 'a.png',
          fields: { entityType: 'PRODUCT', entityId: 'p1' },
        })
      ).body.data;
      const res = (await http.get(`/files/${file.id}/url`, b.token).expect(200)).body.data;
      expect(Math.abs(new Date(res.expiresAt).getTime() - Date.now() - 300_000)).toBeLessThan(5000);
      expect(res.thumbnailUrl).toBeTruthy();

      const fetchSigned = (url: string) =>
        request(app.getHttpServer()).get(url.replace('http://localhost:4000', ''));
      const ok = await fetchSigned(res.url).expect(200);
      expect(ok.headers['content-type']).toMatch(/image\/png/);
      expect(ok.headers['content-disposition']).toBe('inline');
      expect(ok.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.isBuffer(ok.body)).toBe(true);
      expect((await sharp(ok.body).metadata()).width).toBe(300);
      await fetchSigned(res.thumbnailUrl).expect(200);

      await fetchSigned(res.url.replace(/sig=[0-9a-f]{4}/, 'sig=0000')).expect(404);
      await fetchSigned(res.url.replace(/exp=\d+/, 'exp=1')).expect(404);
      await request(app.getHttpServer())
        .get('/api/v1/files/local?key=ws/x/2026/10/a.png&exp=9999999999&sig=abc')
        .expect(404);
    });

    it('checks the tenant: another workspace’s file is a 404 for url and delete', async () => {
      const a = await business();
      const other = await business();
      const file = (
        await upload(a.token, await png(10, 10), {
          fields: { entityType: 'PRODUCT', entityId: 'p1' },
        })
      ).body.data;
      await http.get(`/files/${file.id}/url`, other.token).expect(404);
      await http.del(`/files/${file.id}`, other.token).expect(404);
      await http.get('/files/does-not-exist/url', a.token).expect(404);
      await http.get(`/files/${file.id}/url`, a.token).expect(200);
      expect(await prisma().fileAsset.count({ where: { id: file.id } })).toBe(1);
    });

    it('checks the linked record’s permission; an unattached file belongs to its uploader', async () => {
      const b = await business();
      const cashier = await b.member('Cashier', 'viewer-c@files.test');
      const attached = (
        await upload(b.token, await png(10, 10), {
          fields: { entityType: 'EXPENSE', entityId: 'e1', purpose: 'proof' },
        })
      ).body.data;
      expect((await http.get(`/files/${attached.id}/url`, cashier).expect(403)).body.code).toBe(
        'PERMISSION_DENIED',
      );

      const mine = (await upload(cashier, await png(10, 10))).body.data;
      await http.get(`/files/${mine.id}/url`, cashier).expect(200);
      await http.get(`/files/${mine.id}/url`, b.token).expect(404); // not even the Owner sees someone's unattached upload
    });
  });

  describe('deletion (Requirement 34.8)', () => {
    it('removes the row and the stored objects, and audits it', async () => {
      const b = await business();
      const file = (
        await upload(b.token, await png(50, 50), {
          fields: { entityType: 'PRODUCT', entityId: 'p1' },
        })
      ).body.data;
      const row = await prisma().fileAsset.findUniqueOrThrow({ where: { id: file.id } });
      await http.del(`/files/${file.id}`, b.token).expect(204);
      expect(await prisma().fileAsset.count({ where: { id: file.id } })).toBe(0);
      expect(await storage().head(row.storageKey)).toBeNull();
      expect(await storage().head(row.thumbnailKey as string)).toBeNull();
      expect(
        await prisma().auditEvent.count({
          where: { workspaceId: b.workspaceId, action: 'file.delete', entityId: file.id },
        }),
      ).toBe(1);
      await http.del(`/files/${file.id}`, b.token).expect(404);
    });

    it('refuses to delete a message attachment or a file an issued document uses', async () => {
      const b = await business();
      const message = (
        await upload(b.token, await png(10, 10), {
          fields: { entityType: 'MESSAGE', entityId: 'm1', purpose: 'media' },
        })
      ).body.data;
      const res = await http.del(`/files/${message.id}`, b.token).expect(409);
      expect(res.body.code).toBe('FILE_IN_USE');

      const logo = (
        await upload(b.token, await png(10, 10), {
          fields: { entityType: 'ORDER', entityId: 'o1' },
        })
      ).body.data;
      const registry = app.get(FileReferenceRegistry);
      registry.register('test-invoice', async (id) => id === logo.id);
      await http.del(`/files/${logo.id}`, b.token).expect(409);
      registry.register('test-invoice', async () => false);
      await http.del(`/files/${logo.id}`, b.token).expect(204);
      expect(await prisma().fileAsset.count({ where: { id: message.id } })).toBe(1);
    });

    it('only the uploader or someone who may edit the record can delete', async () => {
      const b = await business();
      const manager = await b.member('Manager', 'mgr@files.test'); // has product:edit
      const cashier = await b.member('Cashier', 'cashier2@files.test'); // does not
      const file = (
        await upload(b.token, await png(10, 10), {
          fields: { entityType: 'PRODUCT', entityId: 'p1' },
        })
      ).body.data;
      await http.del(`/files/${file.id}`, cashier).expect(403);
      await http.del(`/files/${file.id}`, manager).expect(204);
    });
  });

  describe('for modules that own records', () => {
    it('attaches an uploaded file to a record and lists the files of that record', async () => {
      const b = await business();
      const staged = (await upload(b.token, await png(10, 10), { filename: 'ref.png' })).body.data;
      const other = (
        await upload(b.token, pdf(), {
          filename: 'terms.pdf',
          fields: { entityType: 'QUOTATION', entityId: 'q9' },
        })
      ).body.data;
      const files = app.get(FilesService);

      const { runWithWorkspace } = await import('./helpers/context');
      await runWithWorkspace(app, b.workspaceId, async () => {
        const linked = await files.attach(staged.id, {
          entityType: 'ORDER_ITEM',
          entityId: 'item1',
          purpose: 'reference',
        });
        expect(linked).toMatchObject({
          entityType: 'ORDER_ITEM',
          entityId: 'item1',
          purpose: 'reference',
        });
        expect((await files.listForEntity('ORDER_ITEM', 'item1')).map((f) => f.id)).toEqual([
          staged.id,
        ]);
        expect(await files.listForEntity('ORDER_ITEM', 'nothing')).toEqual([]);
        await expect(
          files.attach(other.id, { entityType: 'ORDER', entityId: 'o1' }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
        await expect(
          files.attach('missing', { entityType: 'ORDER', entityId: 'o1' }),
        ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      });
    });
  });

  describe('readiness', () => {
    it('reports storage in /health/ready and fails when it is down', async () => {
      const ok = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
      expect(ok.body.data.checks.storage).toBe('up');

      const spy = jest.spyOn(storage(), 'ping').mockRejectedValue(new Error('disk gone'));
      const down = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
      expect(down.body.details.failed).toContain('storage');
      expect(JSON.stringify(down.body)).not.toContain('disk gone');
      spy.mockRestore();
      expect(
        app
          .get(ReadinessRegistry)
          .all()
          .map((c) => c.name),
      ).toEqual(expect.arrayContaining(['database', 'storage']));
    });
  });
});

describe('driver selection (Requirement 34.1)', () => {
  it('uses the local driver in development and the S3 driver when configured', () => {
    expect(createStorage({ ...testEnv(), STORAGE_DRIVER: 'local' })).toBeInstanceOf(
      LocalDiskStorage,
    );
    const s3 = createStorage({
      ...testEnv(),
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'bms',
      S3_ACCESS_KEY: 'a',
      S3_SECRET_KEY: 'b',
      S3_REGION: 'us-east-1',
    });
    expect(s3).toBeInstanceOf(S3Storage);
  });
});

function parseSigned(url: string): [string, number, string] {
  const q = new URL(url).searchParams;
  return [q.get('key') as string, Number(q.get('exp')), q.get('sig') as string];
}
