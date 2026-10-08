import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: '<rootDir>/test/jsdom-env.cjs',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: ['<rootDir>/**/*.test.{ts,tsx}'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
};

// next-intl and its dependencies ship ES modules only; let Jest transform them.
const ESM_PACKAGES = 'next-intl|use-intl|intl-messageformat|@formatjs|icu-minify';

const resolveConfig = async () => {
  const resolved = await createJestConfig(config)();
  resolved.transformIgnorePatterns = [
    `/node_modules/(?!.*(?:${ESM_PACKAGES}))`,
    '^.+\\.module\\.(css|sass|scss)$',
  ];
  return resolved;
};

export default resolveConfig;
