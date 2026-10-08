import { Prisma } from '@prisma/client';
import { computeStateChange, redact, toJsonSafe, REDACTED } from '../audit-diff';

describe('toJsonSafe', () => {
  it('serializes decimals, dates and bigints without losing precision', () => {
    const out = toJsonSafe({
      amount: new Prisma.Decimal('10.1000'),
      at: new Date('2026-01-02T03:04:05.000Z'),
      big: 12345678901234567890n,
      nested: [{ n: null, u: undefined }],
    });
    expect(out).toEqual({
      amount: '10.1',
      at: '2026-01-02T03:04:05.000Z',
      big: '12345678901234567890',
      nested: [{ n: null }],
    });
  });
});

describe('redact', () => {
  it('replaces sensitive values at any depth, keeping other fields', () => {
    expect(
      redact({
        name: 'Ann',
        passwordHash: 'x',
        profile: { apiKey: 'k', phone: '1' },
        list: [{ refreshToken: 't', ok: 1 }],
        configEncrypted: 'abc',
      }),
    ).toEqual({
      name: 'Ann',
      passwordHash: REDACTED,
      profile: { apiKey: REDACTED, phone: '1' },
      list: [{ refreshToken: REDACTED, ok: 1 }],
      configEncrypted: REDACTED,
    });
  });
});

describe('computeStateChange', () => {
  it('stores only changed fields for an update, old and new', () => {
    const change = computeStateChange(
      { name: 'A', price: new Prisma.Decimal('1.00'), status: 'DRAFT' },
      { name: 'A', price: new Prisma.Decimal('2.00'), status: 'DRAFT' },
    );
    expect(change).toEqual({ previousState: { price: '1' }, newState: { price: '2' } });
  });

  it('records added and removed keys', () => {
    expect(computeStateChange({ a: 1 }, { a: 1, b: 2 })).toEqual({
      previousState: {},
      newState: { b: 2 },
    });
    expect(computeStateChange({ a: 1, b: 2 }, { a: 1 })).toEqual({
      previousState: { b: 2 },
      newState: {},
    });
  });

  it('stores the full state for create and delete, and nothing for neither', () => {
    expect(computeStateChange(null, { id: '1', passwordHash: 'h' })).toEqual({
      previousState: null,
      newState: { id: '1', passwordHash: REDACTED },
    });
    expect(computeStateChange({ id: '1' }, null)).toEqual({
      previousState: { id: '1' },
      newState: null,
    });
    expect(computeStateChange()).toEqual({ previousState: null, newState: null });
  });

  it('never leaks a secret through the diff', () => {
    const change = computeStateChange(
      { passwordHash: 'old-secret' },
      { passwordHash: 'new-secret' },
    );
    expect(JSON.stringify(change)).not.toContain('secret');
    expect(change.newState).toEqual({ passwordHash: REDACTED });
  });
});
