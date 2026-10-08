const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const isMutating = (method: string): boolean => MUTATING.has(method.toUpperCase());

/** The origin the browser used to reach this server, allowing for a reverse proxy in front. */
export function requestOrigin(headers: Headers, fallbackUrl: URL): string {
  const first = (value: string | null) => value?.split(',')[0]?.trim() || undefined;
  const proto = first(headers.get('x-forwarded-proto')) ?? fallbackUrl.protocol.replace(':', '');
  const host =
    first(headers.get('x-forwarded-host')) ?? first(headers.get('host')) ?? fallbackUrl.host;
  return `${proto}://${host}`;
}

/**
 * Cross-site request forgery guard for the cookie-authenticated BFF: a state-changing request must
 * carry an Origin header equal to this site's own origin (design "Web session").
 */
export function isSameOrigin(headers: Headers, fallbackUrl: URL): boolean {
  const origin = headers.get('origin');
  return origin !== null && origin === requestOrigin(headers, fallbackUrl);
}
