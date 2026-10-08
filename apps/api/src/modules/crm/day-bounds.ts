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

/** The instants at which the local day containing `now` starts and the next one starts. */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const local = new Date(now.getTime() + offsetMs(now, timeZone));
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const midnight = (day: number) => {
    const guess = Date.UTC(y, m, day);
    // the offset can differ between the guess and the real midnight around a clock change
    const first = guess - offsetMs(new Date(guess), timeZone);
    return new Date(guess - offsetMs(new Date(first), timeZone));
  };
  return { start: midnight(d), end: midnight(d + 1) };
}
