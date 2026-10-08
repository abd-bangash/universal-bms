import { NextResponse, type NextRequest } from 'next/server';
import { WORKSPACES_COOKIE } from '@/lib/bff/constants';

export const dynamic = 'force-dynamic';

/** The workspaces the user can choose from after login, kept in an HTTP-only cookie. */
export function GET(req: NextRequest) {
  const raw = req.cookies.get(WORKSPACES_COOKIE)?.value;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return NextResponse.json({ data: parsed });
  } catch {
    // fall through
  }
  return NextResponse.json(
    {
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'Your sign-in expired; sign in again',
      requestId: 'bff',
    },
    { status: 401 },
  );
}
