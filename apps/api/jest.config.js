/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  // e2e tests boot the application against a real database; seeding the demo business takes seconds
  testTimeout: 60_000,
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '(src/.*\\.spec|test/.*\\.(e2e-)?spec)\\.ts$',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.generated.ts'],
  coverageThreshold: {
    './src/common/prisma/tenant.extension.ts': {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    },
  },
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};
