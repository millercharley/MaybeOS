import { readFileSync } from 'fs';
import { join } from 'path';
import { scrubEvent } from '@/sentry.shared';
import type { ErrorEvent, EventHint } from '@sentry/nextjs';

/**
 * What is worth waking somebody up for (OPS-09).
 *
 * Charley: "I see some email notifications on alerts." Reviewing them, almost
 * nothing in the project was a defect — 93% was one bundling mistake, and of
 * the rest, one member's laptop produced 110 reports of a poll it could not
 * finish. An alert nobody can act on teaches people to ignore the alerts.
 *
 * The line held here: the API refusing, correctly, is not an error. The API
 * failing is.
 */
const refusal = (status: number) =>
  ({ originalException: Object.assign(new Error('nope'), { name: 'ApiError', status }) }) as EventHint;

describe('an expected refusal is not an error', () => {
  const scrub = (hint: EventHint) => scrubEvent({} as ErrorEvent, hint);

  it('drops the Code of Conduct block, which is the product working', () => {
    /*
      `RequiredReadingInterceptor` raises a 403 with the article attached so
      the member can go and read it. It reached Sentry as an unhandled
      rejection, where the global handler cannot tell a boundary from a bug.
    */
    expect(scrub(refusal(403))).toBeNull();
  });

  it('drops the ordinary 4xx a product raises all day', () => {
    for (const status of [400, 401, 404, 409, 422, 429]) {
      expect(scrub(refusal(status))).toBeNull();
    }
  });

  it('keeps a 5xx, which is our own defect', () => {
    // The API client reports these deliberately, with a route and a
    // fingerprint. Dropping them here would undo that.
    for (const status of [500, 502, 503, 504]) {
      expect(scrub(refusal(status))).not.toBeNull();
    }
  });

  it('keeps an unreachable API', () => {
    const hint = {
      originalException: Object.assign(new Error('unreachable'), { name: 'ApiNetworkError' }),
    } as EventHint;

    expect(scrub(hint)).not.toBeNull();
  });

  it('keeps anything that is not an ApiError, whatever it carries', () => {
    // A TypeError that happens to have a `status` is still a bug.
    const hint = {
      originalException: Object.assign(new TypeError('boom'), { status: 404 }),
    } as EventHint;

    expect(scrub(hint)).not.toBeNull();
  });

  it('keeps an event with no exception at all', () => {
    expect(scrub({} as EventHint)).not.toBeNull();
    expect(scrubEvent({} as ErrorEvent, undefined as unknown as EventHint)).not.toBeNull();
  });

  it('still scrubs the events it keeps', () => {
    // Dropping must not have jumped the queue ahead of the IP rule.
    const out = scrub(refusal(500));
    expect(out?.user?.ip_address).toBeNull();
  });
});

describe('a poll nobody is waiting for', () => {
  /*
    Comments stripped before scanning. The comment explaining why the timer
    must not be handed `load` directly contains the very text asserted
    against, so the guard passed against the bug until it was taken out.
  */
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const api = strip(readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8'));
  const context = strip(readFileSync(join(__dirname, '..', 'contexts', 'unread-context.tsx'), 'utf8'));

  it('does not report that it could not reach the API', () => {
    // One account produced 104 of the 122 reports on this route: a tab left
    // open, and every lid-close aborting whatever was in flight.
    const caught = api.slice(api.indexOf('const err = new ApiNetworkError'));
    const block = caught.slice(0, caught.indexOf('Sentry.captureException'));

    expect(block).toMatch(/if \(background\)/);
    expect(block).toMatch(/throw err;/);
  });

  it('still reports a 5xx, however the request was made', () => {
    /*
      The distinction the whole change rests on: a network failure is the
      client's circumstances, a 5xx is our server. Suppressing both would
      have hidden the eight /unread 502s that were worth knowing about.
    */
    const at = api.indexOf('response.status >= 500');
    // Anchored without the closing paren, and asserted to exist: with it,
    // adding `&& !background` made indexOf return -1 and the check vacuous.
    expect(at).toBeGreaterThan(-1);
    expect(api.slice(at, at + 400)).not.toMatch(/background/);
  });

  it('marks the timer as background and nothing else', () => {
    expect(context).toMatch(/setInterval\(\(\) => load\(true\), EVERY\)/);
    // The first load and refresh() both have somebody waiting on them.
    expect(context).toMatch(/const load = useCallback\(async \(background = false\)/);
    expect(context).toMatch(/void load\(\);/);
  });

  it('does not hand setInterval the function directly', () => {
    /*
      `setInterval(load, EVERY)` would pass the timer's own argument into
      `load`, and `load`'s first parameter is the one deciding whether a
      failure is reported. It happens to be falsy today, which is the kind of
      accident that stops being true when a parameter is added.
    */
    expect(context).not.toMatch(/setInterval\(load,/);
  });
});

describe('the sanitiser is not bundled into the server', () => {
  const config = readFileSync(join(__dirname, '..', 'next.config.ts'), 'utf8');

  it('leaves isomorphic-dompurify external', () => {
    /*
      It loads jsdom in Node, and jsdom reads its own stylesheet off disk.
      Bundling took the JavaScript and left the file, so every server render
      of a page with rich text threw ENOENT — 1,988 of them, 93% of every
      error the product reported.
    */
    expect(config).toMatch(/serverExternalPackages: \['isomorphic-dompurify'\]/);
  });
});
