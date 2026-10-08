import { createHmac, timingSafeEqual } from 'node:crypto';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { StorageAdapter } from '@bms/types';

/** `ws/<workspaceId>/<yyyy>/<mm>/<id>[.thumb].<ext>`: the only shape of key the system produces. */
export const STORAGE_KEY_PATTERN =
  /^ws\/[A-Za-z0-9_-]+\/\d{4}\/\d{2}\/[A-Za-z0-9-]+(\.thumb)?\.[a-z0-9]{2,5}$/;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  csv: 'text/csv',
};

/**
 * Development driver. Files live under a directory on disk and are served by the API itself
 * through `GET /files/local`, with an HMAC-signed, expiring URL.
 */
export class LocalDiskStorage implements StorageAdapter {
  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string,
    private readonly signingSecret: string,
    private readonly now: () => number = Date.now,
  ) {}

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
    this.pathOf(key);
    const exp = Math.floor(this.now() / 1000) + ttlSeconds;
    const query = new URLSearchParams({ key, exp: String(exp), sig: this.sign(key, exp) });
    return `${this.publicBaseUrl}/api/v1/files/local?${query.toString()}`;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async head(key: string): Promise<{ size: number; mime: string } | null> {
    const path = this.pathOf(key); // an invalid key is a bug, not "missing"
    try {
      const info = await stat(path);
      return { size: info.size, mime: mimeOf(key) };
    } catch {
      return null;
    }
  }

  async ping(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.W_OK);
  }

  /** Used by the download route: verifies the signature and expiry, then returns the bytes. */
  async readSigned(
    key: string,
    exp: number,
    sig: string,
  ): Promise<{ body: Buffer; mime: string } | null> {
    if (!Number.isInteger(exp) || exp * 1000 < this.now()) return null;
    const expected = Buffer.from(this.sign(key, exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      return { body: await readFile(this.pathOf(key)), mime: mimeOf(key) };
    } catch {
      return null;
    }
  }

  private sign(key: string, exp: number): string {
    return createHmac('sha256', this.signingSecret).update(`${key}\n${exp}`).digest('hex');
  }

  private pathOf(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    const path = resolve(this.root, key);
    if (!path.startsWith(resolve(this.root) + sep)) throw new Error('Invalid storage key');
    return path;
  }
}

export function mimeOf(key: string): string {
  return MIME_BY_EXTENSION[key.slice(key.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
}
