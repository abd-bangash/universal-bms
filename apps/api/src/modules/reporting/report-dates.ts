/** Offset of a timezone from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a local calendar day starts in a timezone (midnight there), for `YYYY-MM-DD`. */
export function localDayStart(day: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // the offset can differ between the guess and the real midnight around a clock change
  const first = guess - offsetMs(new Date(guess), timeZone);
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

/** `YYYY-MM-DD` of an instant as the calendar shows it in a timezone. */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Adds whole days to a `YYYY-MM-DD` string. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type RangePreset = 'today' | 'week' | 'month';

/**
 * The local days a report covers. Explicit `from` and `to` win; else a preset ("week" starts on
 * Monday); else the current month, which is what every date-ranged report shows by default.
 */
export function resolveRange(
  input: { from?: string; to?: string; range?: RangePreset },
  timeZone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = localDay(now, timeZone);
  if (input.from || input.to) {
    const from = input.from ?? input.to ?? today;
    const to = input.to ?? today;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  if (input.range === 'today') return { from: today, to: today };
  if (input.range === 'week') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    return { from: addDays(today, -((weekday + 6) % 7)), to: today };
  }
  return { from: `${today.slice(0, 8)}01`, to: today };
}
