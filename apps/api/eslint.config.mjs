import base from '@bms/config/eslint';

/** Only these places may touch the raw, unscoped Prisma client (design.md "Workspace Context"). */
export const UNSCOPED_ALLOWED = [
  'src/common/prisma/**',
  'src/modules/auth/**',
  'src/modules/tenants/**',
  'src/modules/platform/**',
  'src/modules/channels/webhook-workspace/**',
  'prisma/seed/**',
  'src/seed/**',
  'src/cli/**',
  'test/**',
  '**/*.spec.ts',
];

const config = [
  ...base,
  { ignores: ['jest.config.js', 'scripts/**'] },
  {
    files: ['src/**/*.ts', 'prisma/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='unscoped']",
          message:
            'prisma.unscoped is restricted to auth, tenants, platform, webhook workspace resolution and seeds. Use prisma.scoped.',
        },
      ],
    },
  },
  { files: UNSCOPED_ALLOWED, rules: { 'no-restricted-syntax': 'off' } },
];

export default config;
