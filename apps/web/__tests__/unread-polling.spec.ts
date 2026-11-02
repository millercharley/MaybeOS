import { stripComments } from './helpers/source-scan';
import {
  nextPollDelay,
  sameCounts,
  POLL_BASE_MS,
  POLL_MAX_MS,
  NO_UNREAD,
} from '@/lib/unread';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * How often the badge asks (CMN-29).
 *
 * Measured over ninety minutes on production: 417 polls of `/unread`, at
 * seven database queries each — about 2,900 queries — to render a number
 * that changed **twice**. Express answered 304 to most of them, which saved
 * the bandwidth and none of the work: by the time it knows nothing changed,
 * the handler has run every query and hashed the result.
 */
describe('how long to wait before asking again', () => {
  it('asks again promptly while things are happening', () => {
    expect(nextPollDelay(POLL_BASE_MS, true)).toBe(POLL_BASE_MS);
    expect(nextPollDelay(POLL_MAX_MS, true)).toBe(POLL_BASE_MS);
  });

  it('doubles while nothing is', () => {
    expect(nextPollDelay(60_000, false)).toBe(120_000);
    expect(nextPollDelay(120_000, false)).toBe(240_000);
  });

  /**
   * A badge is glanced at, not waited on — but a member returning to a tab
   * and seeing nothing new for ten minutes would reasonably decide the
   * feature is broken.
   */
  it('never waits longer than the ceiling', () => {
    expect(nextPollDelay(POLL_MAX_MS, false)).toBe(POLL_MAX_MS);
    expect(nextPollDelay(POLL_MAX_MS * 4, false)).toBe(POLL_MAX_MS);
  });

  it('settles at the ceiling rather than growing forever', () => {
    let delay = POLL_BASE_MS;
    for (let i = 0; i < 20; i++) delay = nextPollDelay(delay, false);

    expect(delay).toBe(POLL_MAX_MS);
  });
});

/**
 * The comparison the backoff rests on.
 *
 * By value, not identity: the API builds a fresh object every poll, so `!==`
 * would report a change every time and the backoff would never back off.
 */
describe('whether two readings say the same thing', () => {
  const counts = (over: Partial<typeof NO_UNREAD> = {}) => ({ ...NO_UNREAD, ...over });

  it('is true for two separately built but equal readings', () => {
    expect(sameCounts(counts({ messages: 2, channels: { a: 1 } }), counts({ messages: 2, channels: { a: 1 } }))).toBe(true);
  });

  it.each([
    ['messages', counts({ messages: 1 }), counts({ messages: 2 })],
    ['the Commons total', counts({ commons: 1 }), counts({ commons: 2 })],
    ['a channel’s count', counts({ channels: { a: 1 } }), counts({ channels: { a: 2 } })],
  ])('notices a change in %s', (_label, a, b) => {
    expect(sameCounts(a, b)).toBe(false);
  });

  /**
   * A channel that drops to zero leaves the map entirely (CMN-27), so the
   * keys have to be unioned. Walking one side only would call that unchanged
   * and leave a stale dot on the rail.
   */
  it('notices a channel that cleared', () => {
    expect(sameCounts(counts({ channels: { a: 2 } }), counts({ channels: {} }))).toBe(false);
    expect(sameCounts(counts({ channels: {} }), counts({ channels: { a: 2 } }))).toBe(false);
  });

  it('treats an absent map and an empty one as the same', () => {
    expect(sameCounts({ messages: 0, commons: 0 }, counts({ channels: {} }))).toBe(true);
  });
});

/**
 * And a tab nobody is looking at does not ask at all.
 *
 * A source scan: the behaviour is a timer that is not scheduled, and this
 * app's harness renders no components.
 */
describe('the poller', () => {
  const RAW = readFileSync(join(__dirname, '..', 'contexts', 'unread-context.tsx'), 'utf8');

  /*
    Comments stripped, because the file explains the very thing it must not
    contain — "`setTimeout` rather than `setInterval`" trips a scan for
    `setInterval`. The same lesson as `unauthenticated-routes`,
    `tenant-scoping`, the embed scan and `local-date-from-instant`: a file
    that fixes a bug also describes it.
  */
  const SOURCE = stripComments(RAW);

  it('really did strip its comments', () => {
    // Otherwise every check below passes or fails for the wrong reason.
    expect(RAW).toContain('rather than `setInterval`');
    expect(SOURCE).not.toContain('rather than `setInterval`');
  });

  it('stops for a hidden tab and starts again when it is shown', () => {
    expect(SOURCE).toContain("document.visibilityState !== 'hidden'");
    expect(SOURCE).toContain("addEventListener('visibilitychange'");
    expect(SOURCE).toContain("removeEventListener('visibilitychange'");
  });

  /*
    Sliced to the function body, not searched file-wide.

    The first version of these checks asserted that `watching()` and
    `setTimeout(run, delay)` appeared *somewhere*. Both survived deleting the
    guard from `schedule` and replacing the backoff with a constant, because
    the helpers they named were still defined further up. A test that reads
    the vocabulary rather than the wiring passes against code that does
    nothing — which is what the mutation run showed.
  */
  const body = (name: string) => {
    const start = SOURCE.indexOf(`const ${name} = `);
    expect(start).toBeGreaterThan(-1);
    // To the end of the arrow function: the next line at the same indent.
    const rest = SOURCE.slice(start);
    const end = rest.indexOf('\n    };');
    return rest.slice(0, end === -1 ? rest.length : end);
  };

  /** A fixed interval cannot back off, which is the whole point. */
  it('uses a timeout it can vary, not a fixed interval', () => {
    expect(SOURCE).not.toContain('setInterval');
    expect(body('schedule')).toContain('setTimeout(run, delay)');
  });

  /** The guard has to be in `schedule`, not merely defined above it. */
  it('refuses to schedule anything for a hidden tab', () => {
    expect(body('schedule')).toContain('!watching()');
  });

  /** And the delay has to come from the backoff, not be reset every time. */
  it('takes its next delay from the backoff', () => {
    expect(body('run')).toContain('nextPollDelay(delay,');
    expect(body('run')).toContain('sameCounts(next, last)');
  });

  /** Coming back to a tab should not mean waiting out a four-minute delay. */
  it('resets the delay and refreshes when the tab is shown again', () => {
    expect(SOURCE).toMatch(/delay = POLL_BASE_MS;\s*\n\s*void run\(\);/);
  });

  /** SSR has no `document`; the provider is mounted in the app shell. */
  it('does not assume a browser', () => {
    expect(SOURCE).toContain("typeof document === 'undefined'");
  });
});
