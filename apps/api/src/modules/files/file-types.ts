import { fromBuffer } from 'file-type';

export interface DetectedType {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'text/csv';
  ext: 'jpg' | 'png' | 'webp' | 'pdf' | 'csv';
  isImage: boolean;
}

const BY_MIME: Record<string, DetectedType> = {
  'image/jpeg': { mime: 'image/jpeg', ext: 'jpg', isImage: true },
  'image/png': { mime: 'image/png', ext: 'png', isImage: true },
  'image/webp': { mime: 'image/webp', ext: 'webp', isImage: true },
  'application/pdf': { mime: 'application/pdf', ext: 'pdf', isImage: false },
};

/** CSV has no magic bytes: plain UTF-8 text without control characters, and only where imports are allowed. */
function looksLikeCsv(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const text = buffer.toString('utf8');
  if (text.includes('�')) return false;
  // eslint-disable-next-line no-control-regex -- rejecting binary content is the point
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
}

/**
 * Decides the type from the bytes themselves, never from the file name or the declared type
 * (Requirement 34.2). Returns null for anything outside the allow-list.
 */
export async function detectAllowedType(
  buffer: Buffer,
  allowCsv: boolean,
): Promise<DetectedType | null> {
  const sniffed = await fromBuffer(buffer);
  if (sniffed) return BY_MIME[sniffed.mime] ?? null;
  return allowCsv && looksLikeCsv(buffer) ? { mime: 'text/csv', ext: 'csv', isImage: false } : null;
}
