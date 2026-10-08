import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalDiskStorage, STORAGE_KEY_PATTERN } from '../storage/local-disk.storage';
import { S3Storage } from '../storage/s3.storage';

const KEY = 'ws/ws_1/2026/10/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab.png';
const THUMB = 'ws/ws_1/2026/10/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab.thumb.webp';

describe('storage keys', () => {
  it('accepts the keys the system produces and nothing else', () => {
    expect(STORAGE_KEY_PATTERN.test(KEY)).toBe(true);
    expect(STORAGE_KEY_PATTERN.test(THUMB)).toBe(true);
    for (const bad of [
      '../etc/passwd',
      'ws/../../x.png',
      'ws/ws_1/2026/10/../../x.png',
      'ws/ws_1/2026/10/a b.png',
      '/abs/path.png',
      'ws/ws_1/26/10/a.png',
      '',
    ]) {
      expect(STORAGE_KEY_PATTERN.test(bad)).toBe(false);
    }
  });
});

describe('LocalDiskStorage', () => {
  let root: string;
  let clock = 1_800_000_000_000;
  let storage: LocalDiskStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bms-local-'));
    clock = 1_800_000_000_000;
    storage = new LocalDiskStorage(root, 'http://api.test', 'secret', () => clock);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('stores, describes and deletes objects', async () => {
    expect(await storage.head(KEY)).toBeNull();
    await storage.put(KEY, Buffer.from('hello'));
    expect(await storage.head(KEY)).toEqual({ size: 5, mime: 'image/png' });
    await storage.delete(KEY);
    expect(await storage.head(KEY)).toBeNull();
    await storage.delete(KEY); // deleting twice is fine
    await storage.ping();
  });

  it('refuses keys that could escape the storage directory', async () => {
    await expect(storage.put('../../outside.png', Buffer.from('x'))).rejects.toThrow();
    await expect(storage.head('ws/a/2026/10/../../../x.png')).rejects.toThrow();
    await expect(storage.getSignedUrl('nope', 60)).rejects.toThrow();
  });

  it('issues URLs that work until they expire', async () => {
    await storage.put(KEY, Buffer.from('payload'));
    const url = new URL(await storage.getSignedUrl(KEY, 300));
    expect(url.origin + url.pathname).toBe('http://api.test/api/v1/files/local');
    const key = url.searchParams.get('key') as string;
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig') as string;
    expect(exp).toBe(clock / 1000 + 300);

    expect((await storage.readSigned(key, exp, sig))?.body.toString()).toBe('payload');
    clock += 299_000;
    expect(await storage.readSigned(key, exp, sig)).not.toBeNull();
    clock += 2_000;
    expect(await storage.readSigned(key, exp, sig)).toBeNull(); // five minutes have passed
  });

  it('rejects tampered signatures, keys and expiries', async () => {
    await storage.put(KEY, Buffer.from('a'));
    await storage.put('ws/ws_2/2026/10/zzzz.png', Buffer.from('b'));
    const url = new URL(await storage.getSignedUrl(KEY, 300));
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig') as string;
    expect(await storage.readSigned('ws/ws_2/2026/10/zzzz.png', exp, sig)).toBeNull();
    expect(await storage.readSigned(KEY, exp + 3600, sig)).toBeNull();
    expect(await storage.readSigned(KEY, exp, `${sig.slice(0, -1)}0`)).toBeNull();
    expect(await storage.readSigned(KEY, exp, 'short')).toBeNull();
    expect(await storage.readSigned(KEY, Number.NaN, sig)).toBeNull();
    const other = new LocalDiskStorage(root, 'http://api.test', 'another-secret', () => clock);
    expect(await other.readSigned(KEY, exp, sig)).toBeNull();
  });
});

describe('S3Storage (against an in-process S3-compatible server)', () => {
  const objects = new Map<string, { body: Buffer; type: string }>();
  let server: Server;
  let storage: S3Storage;
  let endpoint: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0] as string);
        const [, bucket, ...rest] = path.split('/');
        const key = rest.join('/');
        const authorized = (req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256');
        if (!authorized || bucket !== 'bms') {
          res.writeHead(bucket === 'bms' ? 403 : 404).end();
          return;
        }
        if (!key) return void res.writeHead(200).end(); // HeadBucket
        const stored = objects.get(key);
        if (req.method === 'PUT') {
          objects.set(key, {
            body: Buffer.concat(chunks),
            type: String(req.headers['content-type']),
          });
          return void res.writeHead(200, { ETag: '"x"' }).end();
        }
        if (req.method === 'DELETE') {
          objects.delete(key);
          return void res.writeHead(204).end();
        }
        if (req.method === 'HEAD') {
          if (!stored) return void res.writeHead(404).end();
          return void res
            .writeHead(200, { 'Content-Length': stored.body.length, 'Content-Type': stored.type })
            .end();
        }
        res.writeHead(405).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    storage = new S3Storage({
      endpoint,
      bucket: 'bms',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'super-secret-key',
      region: 'us-east-1',
    });
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('puts, describes and deletes objects', async () => {
    await storage.put(KEY, Buffer.from('image-bytes'), 'image/png');
    expect(objects.get(KEY)?.body.toString()).toBe('image-bytes');
    expect(await storage.head(KEY)).toEqual({ size: 11, mime: 'image/png' });
    await storage.delete(KEY);
    expect(await storage.head(KEY)).toBeNull();
  });

  it('pings the bucket and fails for a missing one', async () => {
    await expect(storage.ping()).resolves.toBeUndefined();
    const wrong = new S3Storage({
      endpoint,
      bucket: 'missing',
      accessKey: 'a',
      secretKey: 'b',
      region: 'us-east-1',
    });
    await expect(wrong.ping()).rejects.toBeDefined();
  });

  it('signs download URLs that expire and never contain the secret key', async () => {
    const url = new URL(await storage.getSignedUrl(KEY, 300));
    expect(url.origin).toBe(endpoint);
    expect(url.pathname).toBe(`/bms/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.toString()).not.toContain('super-secret-key');
  });
});
