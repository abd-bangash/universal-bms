import { numberExample } from './numbering';

describe('numberExample', () => {
  it('shows what the next number looks like', () => {
    expect(numberExample({ prefix: 'QT-', includeYear: true, padding: 4 }, 2026)).toBe(
      'QT-2026-0001',
    );
    expect(numberExample({ prefix: 'RCP-', includeYear: true, padding: 5 }, 2026)).toBe(
      'RCP-2026-00001',
    );
    expect(numberExample({ prefix: 'INV', includeYear: false, padding: 6 }, 2026, 42)).toBe(
      'INV000042',
    );
    expect(numberExample({ prefix: '', includeYear: false, padding: 1 })).toBe('1');
  });

  it('copes with an unusable padding while the user is typing', () => {
    expect(numberExample({ prefix: 'A-', includeYear: false, padding: Number.NaN })).toBe('A-1');
    expect(numberExample({ prefix: 'A-', includeYear: false, padding: 0 })).toBe('A-1');
  });
});
