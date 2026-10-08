import { Writable } from 'node:stream';
import { createLogger } from '../logger';

function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines: () => chunks.map((c) => JSON.parse(c) as Record<string, unknown>) };
}

describe('logger redaction', () => {
  it('redacts secrets and personal data at several depths', () => {
    const { stream, lines } = capture();
    const log = createLogger('info', stream);
    log.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'bms_at=xyz', 'x-ok': 'visible' } },
        password: 'p1',
        body: { refreshToken: 'r1', nested: { apiKey: 'k1' }, name: 'visible-name' },
        phone: '+923001234567',
        email: 'a@b.c',
      },
      'test',
    );
    const text = JSON.stringify(lines()[0]);
    for (const secret of ['Bearer abc', 'bms_at=xyz', 'p1', 'r1', 'k1', '+923001234567', 'a@b.c']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('visible');
    expect(text).toContain('[REDACTED]');
  });
});
