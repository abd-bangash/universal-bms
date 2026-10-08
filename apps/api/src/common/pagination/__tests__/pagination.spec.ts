import { decodeCursor, encodeCursor, parseSort, toPage } from '../pagination';
import { ValidationFailedException } from '../../errors/app.exception';

describe('cursor', () => {
  it('round-trips and is opaque', () => {
    const cursor = encodeCursor({ id: 'abc', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(cursor).not.toContain('abc');
    expect(decodeCursor(cursor)).toEqual({ id: 'abc', createdAt: '2026-01-01T00:00:00.000Z' });
  });

  it.each([
    '',
    '%%%',
    Buffer.from('[1]').toString('base64url'),
    Buffer.from('nope').toString('base64url'),
  ])('rejects garbage %p', (bad) => {
    expect(() => decodeCursor(bad)).toThrow(ValidationFailedException);
  });
});

describe('toPage', () => {
  const rows = [1, 2, 3, 4, 5].map((id) => ({ id }));

  it('returns a next cursor from the last returned row when more rows exist', () => {
    const page = toPage(rows.slice(0, 4), 3, (r) => ({ id: r.id }));
    expect(page.items).toEqual(rows.slice(0, 3));
    expect(decodeCursor(page.nextCursor as string)).toEqual({ id: 3 });
  });

  it('has no cursor on the last page', () => {
    const page = toPage(rows.slice(0, 3), 3, (r) => ({ id: r.id }));
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeUndefined();
  });
});

describe('parseSort', () => {
  const fallback = { field: 'createdAt', direction: 'desc' } as const;
  it('uses the fallback, accepts allowed fields and rejects others', () => {
    expect(parseSort(undefined, ['name'], fallback)).toEqual(fallback);
    expect(parseSort('name:desc', ['name'], fallback)).toEqual({
      field: 'name',
      direction: 'desc',
    });
    expect(parseSort('name', ['name'], fallback)).toEqual({ field: 'name', direction: 'asc' });
    expect(() => parseSort('password:asc', ['name'], fallback)).toThrow(ValidationFailedException);
    expect(() => parseSort('name:sideways', ['name'], fallback)).toThrow(ValidationFailedException);
  });
});
