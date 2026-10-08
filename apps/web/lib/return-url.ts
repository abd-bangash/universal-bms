/**
 * The page to come back to after signing in. Only same-site paths are accepted, so a crafted
 * link cannot send a user to another site after login (open redirect).
 */
export function sanitizeReturnUrl(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return fallback;
  try {
    const parsed = new URL(value, 'http://placeholder.invalid');
    if (parsed.origin !== 'http://placeholder.invalid') return fallback;
  } catch {
    return fallback;
  }
  if (/^\/(login|select-workspace|invite|reset-password)(\/|\?|$)/.test(value)) return fallback;
  return value;
}

export function loginUrl(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Pages that work without a session. */
export const PUBLIC_PREFIXES = [
  '/login',
  '/select-workspace',
  '/invite',
  '/reset-password',
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
