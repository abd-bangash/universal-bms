import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/bff/constants';
import { isPublicPath, loginUrl } from '@/lib/return-url';

/**
 * Sends visitors without a session to the login page and remembers where they wanted to go.
 * Only the presence of the cookies is checked here; the API validates the tokens on every request.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  const hasSession = req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);
  if (hasSession) return NextResponse.next();
  return NextResponse.redirect(new URL(loginUrl(pathname + search), req.url));
}

export const config = {
  matcher: ['/((?!api/bff|_next/static|_next/image|favicon.ico).*)'],
};
