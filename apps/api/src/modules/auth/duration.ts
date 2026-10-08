const UNITS = { s: 1, m: 60, h: 3600, d: 86_400 } as const;

/** Parses `15m`, `12h`, `30d` into seconds. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  return Number(match[1]) * UNITS[match[2] as keyof typeof UNITS];
}
