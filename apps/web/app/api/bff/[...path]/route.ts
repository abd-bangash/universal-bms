import type { NextRequest } from 'next/server';
import { defaultDeps, handleBff } from '@/lib/bff/proxy';
import { RefreshCoordinator } from '@/lib/bff/refresh-coordinator';

export const dynamic = 'force-dynamic';

// One coordinator per server process, so concurrent requests share a single token refresh.
const coordinator = new RefreshCoordinator();

type Context = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, context: Context) {
  const { path } = await context.params;
  return handleBff(req, path, defaultDeps(coordinator));
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
