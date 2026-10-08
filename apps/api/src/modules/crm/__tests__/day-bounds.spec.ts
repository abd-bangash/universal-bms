import { dayBounds } from '../day-bounds';

describe('dayBounds', () => {
  it('finds the start of the local day and of the next one', () => {
    const now = new Date('2026-10-08T21:30:00Z'); // already the 9th in Karachi (UTC+5)
    const { start, end } = dayBounds(now, 'Asia/Karachi');
    expect(start.toISOString()).toBe('2026-10-08T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-09T19:00:00.000Z');
    expect(dayBounds(now, 'UTC').start.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('copes with zones behind UTC and with clock changes', () => {
    const { start, end } = dayBounds(new Date('2026-10-08T03:00:00Z'), 'America/New_York');
    expect(start.toISOString()).toBe('2026-10-07T04:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-08T04:00:00.000Z');
    // the day the clocks go back in New York is 25 hours long
    const change = dayBounds(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
    expect((change.end.getTime() - change.start.getTime()) / 3_600_000).toBe(25);
    const spring = dayBounds(new Date('2026-03-08T12:00:00Z'), 'America/New_York');
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
  });
});
