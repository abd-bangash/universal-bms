import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for provider credentials (design.md, Secrets): `iv:ciphertext:tag`, each part
 * base64. The key is INTEGRATION_ENCRYPTION_KEY, 32 random bytes as base64. A changed byte
 * anywhere makes decryption fail rather than return something different.
 */
export function encryptJson(keyBase64: string, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, body, cipher.getAuthTag()].map((b) => b.toString('base64')).join(':');
}

export function decryptJson<T = Record<string, string>>(keyBase64: string, stored: string): T {
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Stored credentials are not in the expected format');
  const [iv, body, tag] = parts.map((p) => Buffer.from(p, 'base64')) as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  decipher.setAuthTag(tag);
  const text = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  return JSON.parse(text) as T;
}

/** `••••1234`: enough to recognise a credential, never enough to use it. */
export function mask(value: string): string {
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}
