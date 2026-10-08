export const ACCESS_COOKIE = 'bms_at';
export const REFRESH_COOKIE = 'bms_rt';
/** Short-lived: the login ticket and workspace list while the user picks a workspace. */
export const TICKET_COOKIE = 'bms_lt';
export const WORKSPACES_COOKIE = 'bms_lw';

export const REFRESH_COOKIE_SECONDS = 30 * 24 * 3600;
export const TICKET_COOKIE_SECONDS = 5 * 60;

export const BFF_PREFIX = '/api/bff';

/** Reachable without a session; the BFF neither attaches nor refreshes tokens for these. */
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  'auth/login',
  'auth/select-workspace',
  'auth/password/forgot',
  'auth/password/reset',
  'auth/invite/accept',
]);
