import sharp from 'sharp';
import { detectAllowedType } from '../file-types';
import { sanitizeName } from '../files.service';

const image = (format: 'png' | 'jpeg' | 'webp') => {
  const base = sharp({ create: { width: 20, height: 10, channels: 3, background: '#336699' } });
  return base[format]().toBuffer();
};

describe('detectAllowedType (Requirement 34.2)', () => {
  it('recognises JPEG, PNG, WebP and PDF from their content', async () => {
    expect(await detectAllowedType(await image('png'), false)).toMatchObject({
      mime: 'image/png',
      ext: 'png',
      isImage: true,
    });
    expect(await detectAllowedType(await image('jpeg'), false)).toMatchObject({
      mime: 'image/jpeg',
      ext: 'jpg',
    });
    expect(await detectAllowedType(await image('webp'), false)).toMatchObject({
      mime: 'image/webp',
      ext: 'webp',
    });
    expect(
      await detectAllowedType(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF'), false),
    ).toMatchObject({ mime: 'application/pdf', isImage: false });
  });

  it('refuses everything else, whatever it claims to be', async () => {
    const gif = Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
    const samples: Buffer[] = [
      Buffer.from('<html><script>alert(1)</script></html>'),
      Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), // Windows executable
      Buffer.from('PK\u0003\u0004zipdata'), // zip
      gif,
      Buffer.from('#!/bin/sh\nrm -rf /'),
      Buffer.alloc(0),
    ];
    for (const sample of samples) expect(await detectAllowedType(sample, false)).toBeNull();
  });

  it('accepts CSV only where imports are allowed, and only as clean text', async () => {
    const csv = Buffer.from('sku,name,price\nA1,Chair,10.50\n');
    expect(await detectAllowedType(csv, false)).toBeNull();
    expect(await detectAllowedType(csv, true)).toMatchObject({
      mime: 'text/csv',
      ext: 'csv',
      isImage: false,
    });
    expect(await detectAllowedType(Buffer.from([0x61, 0x2c, 0x00, 0x62]), true)).toBeNull(); // NUL byte
    expect(await detectAllowedType(Buffer.from([0xff, 0xfe, 0xfd]), true)).toBeNull(); // not UTF-8
    expect(await detectAllowedType(Buffer.alloc(0), true)).toBeNull();
  });

  it('does not let a PDF header hide behind a different file in an import', async () => {
    expect(await detectAllowedType(Buffer.from('%PDF-1.4 x'), true)).toMatchObject({
      mime: 'application/pdf',
    });
  });
});

describe('sanitizeName', () => {
  it('keeps a display name only', () => {
    expect(sanitizeName('C:\\Users\\bob\\photo.png')).toBe('photo.png');
    expect(sanitizeName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeName('bad\u0000name\n.png')).toBe('badname.png');
    expect(sanitizeName('   ')).toBe('file');
    expect(sanitizeName('x'.repeat(500))).toHaveLength(200);
  });
});
