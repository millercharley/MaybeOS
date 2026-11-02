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
/**
 * One timezone for the whole suite (OPS-41).
 *
 * `embed-time-and-more.spec.ts` asserts the literal strings the events embed
 * prints — `Sun, Nov 1 · 5:30pm to 7:30pm` — so it needs a known zone. It
 * tried to pin one itself with `process.env.TZ` in a `beforeAll`, which does
 * nothing: `jest-environment-jsdom` builds its realm, and its `Intl`, before
 * any test code runs, so the assignment lands after the zone is fixed. A
 * `setupFiles` entry is too late for the same reason.
 *
 * Here it is early enough. This file is evaluated in jest's parent process
 * before any worker forks, and each worker reads `TZ` at its own startup.
 *
 * The suite passed for months because the machine it was written on is in
 * this zone anyway. It broke the first time CI ran it, in UTC: 5:30pm became
 * 10:30pm and seven tests went down together.
 *
 * America/New_York rather than UTC because the fixtures are wall-clock times
 * at a co-op in Louisville — `5:30pm` is what somebody there reads on the
 * page, and a test pinned to UTC would assert a time nobody sees.
 */
process.env.TZ = 'America/New_York';

const createJestConfig = nextJest({ dir: './' });

module.exports = createJestConfig({
  testEnvironment: 'jest-environment-jsdom',
  testMatch: ['**/__tests__/**/*.spec.[jt]s?(x)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  collectCoverageFrom: ['lib/**/*.ts', 'middleware.ts', 'components/**/*.tsx'],
});
