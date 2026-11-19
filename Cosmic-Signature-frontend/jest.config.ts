import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/e2e/',
    '<rootDir>/.claude/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  watchPathIgnorePatterns: ['<rootDir>/.claude/'],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/styleMock.ts',
    '\\.(jpg|jpeg|png|gif|webp|svg|wav|mp3)$': '<rootDir>/__mocks__/fileMock.ts',
    // The SWC transform rewrites `@/` in import statements from tsconfig
    // paths, but NOT inside jest.mock('...') specifiers (e.g. the global
    // @/i18n/navigation mock in jest.setup.ts). This mapper covers those.
    '^@/(.*)$': '<rootDir>/$1',
  },
  transformIgnorePatterns: [
    // Every pattern here must ALSO exempt anything listed in next.config
    // `transpilePackages` (@formatjs), because jest ignores a path when any
    // pattern matches it.
    '/node_modules/(?!(viem|wagmi|@wagmi|@rainbow-me|@tanstack|abitype|ox|@formatjs)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  collectCoverageFrom: [
    'app/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'config/**/*.{ts,tsx}',
    'contexts/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'i18n/**/*.{ts,tsx}',
    'lib/**/*.{ts,tsx}',
    'proxy.ts',
    'utils/**/*.{ts,tsx}',
    'services/**/*.{ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    // Allow normal run-to-run variation below the full-suite baseline.
    global: { branches: 81, functions: 84, lines: 88, statements: 86 },
  },
};

export default createJestConfig(config);
