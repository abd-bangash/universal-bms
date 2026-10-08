import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const cwd = resolve(__dirname, '../../../..');
const code = 'export const x = (prisma: { unscoped: unknown }) => prisma.unscoped;\n';

/** Lints the snippet as if it lived at `filePath`, in a child process (ESLint's config is ESM). */
function messagesFor(filePath: string): string[] {
  const run = spawnSync(
    'pnpm',
    ['exec', 'eslint', '--stdin', '--stdin-filename', filePath, '--format', 'json'],
    { cwd, input: code, encoding: 'utf8' },
  );
  const [result] = JSON.parse(run.stdout) as Array<{ messages: Array<{ message: string }> }>;
  return (result?.messages ?? []).map((m) => m.message);
}

describe('ESLint rule restricting prisma.unscoped', () => {
  jest.setTimeout(60_000);

  it.each([
    'src/modules/catalog/catalog.service.ts',
    'src/modules/orders/orders.service.ts',
    'src/common/guards/permission.guard.ts',
  ])('forbids it in %s', (file) => {
    expect(messagesFor(file).join()).toContain('prisma.unscoped is restricted');
  });

  it.each([
    'src/modules/auth/auth.service.ts',
    'src/modules/tenants/tenants.service.ts',
    'src/modules/platform/platform.service.ts',
    'src/modules/channels/webhook-workspace/resolver.ts',
    'src/common/prisma/prisma.service.ts',
    'prisma/seed/index.ts',
  ])('allows it in %s', (file) => {
    expect(messagesFor(file)).toEqual([]);
  });
});
