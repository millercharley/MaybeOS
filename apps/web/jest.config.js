const nextJest = require('next/jest');

/**
 * Test harness for apps/web (OPS-10).
 *
 * The web app had no test harness at all — not an empty one, none. That is
 * how `safePath()` shipped a bug that only a production Sentry trace caught:
 * it redacts credentials out of request paths and decides how issues group,
 * and nothing could have exercised it locally.
 *
 * `next/jest` is used rather than a hand-rolled transform so the tests compile
 * the same TypeScript and path aliases the app does; a harness that resolves
 * modules differently from the build is a harness that can pass on code that
 * does not run.
 */
const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
  testEnvironment: 'jest-environment-jsdom',
  testMatch: ['**/__tests__/**/*.spec.[jt]s?(x)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  collectCoverageFrom: ['lib/**/*.ts', 'middleware.ts', 'components/**/*.tsx'],
});
