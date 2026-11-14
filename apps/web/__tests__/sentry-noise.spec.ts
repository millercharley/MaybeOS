import { stripComments } from './helpers/source-scan';
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
    stripComments(s);

  const api = strip(readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8'));
  const context = strip(readFileSync(join(__dirname, '..', 'contexts', 'unread-context.tsx'), 'utf8'));
  const panel = strip(readFileSync(join(__dirname, '..', 'components', 'live', 'happening-now.tsx'), 'utf8'));

  /*
    Sliced to the block between the throw site and the capture, so the rule
    is read where it is enforced rather than anywhere in a 6,400-line file.
  */
  const suppression = () => {
    const caught = api.slice(api.indexOf('const err = new ApiNetworkError'));
    const end = caught.indexOf('Sentry.captureException');
    expect(end).toBeGreaterThan(-1);
    return caught.slice(0, end);
  };

  it('does not report a poll that could not reach the API', () => {
    // One account produced 104 of the 122 reports on this route: a tab left
    // open, and every lid-close aborting whatever was in flight.
    expect(suppression()).toMatch(/background \|\|/);
    expect(suppression()).toMatch(/throw err;/);
  });

  /*
    And does not report a request whose page is already gone (OPS-43).

    This is the other half, and the larger one: 94% of the fifteen
    `api-unreachable` issues came from a phone, arriving four-in-a-second as
    one page load's parallel requests all died together. Asserted as the call,
    not the vocabulary — `worthReporting` being imported proves nothing if the
    `if` no longer consults it.
  */
  it('does not report a request whose page is hidden or leaving', () => {
    expect(suppression()).toMatch(/!worthReporting\(page\)/);
    expect(api).toMatch(/const page = readPageState\(\)/);
  });

  /** The listener has to be attached before `pagehide` can fire. */
  it('starts watching the page lifecycle at import, not on first failure', () => {
    const attach = api.indexOf('watchPageLifecycle()');
    expect(attach).toBeGreaterThan(-1);
    // Above the class, i.e. at module scope rather than inside `request`.
    expect(attach).toBeLessThan(api.indexOf('class ApiClient'));
  });

  /**
   * The issue title has to name the endpoint.
   *
   * Fifteen issues titled "Can't reach MaybeOS right now" is a list nobody
   * can triage, which is how these sat on the work queue for a month.
   */
  it('captures an error whose message carries the route', () => {
    expect(api).toMatch(/captureException\(new ApiUnreachable\(method, route, cause\)/);
    expect(api).toMatch(/super\(`API unreachable: \$\{method\} \$\{route\}`\)/);
    // And the member still gets the sentence written for them.
    expect(api).toContain("super(\"Can't reach MaybeOS right now.");
  });

  /** The fingerprint must not move, or every existing issue splits in two. */
  it('keeps one issue per endpoint, under the fingerprint it already had', () => {
    expect(api).toMatch(/setFingerprint\(\['api-unreachable', method, route\]\)/);
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
    /*
      The timed call is the only one that passes `true` (CMN-29).

      This used to pin the literal `setInterval(() => load(true), EVERY)`.
      The timer became a `setTimeout` that backs off and skips hidden tabs,
      so the shape moved — but the rule it protects did not: a tick nobody is
      waiting for must not report a failure, and the first load and
      `refresh()` must, because somebody is watching the badge when those
      run.
    */
    expect(context).toMatch(/const run = async \(\) => \{\s*\n\s*const next = await load\(true\);/);

    // The first load and refresh() both have somebody waiting on them.
    expect(context).toMatch(/const load = useCallback\(async \(background = false\)/);
    expect(context).toMatch(/void load\(\)/);
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

  /*
    `HappeningNow` is the other live thing in the app, and it kept the timer
    the badge's was replaced for (OPS-43): `setInterval(load, 60_000)`, no
    `background`, no visibility check, running on in a tab behind seven others
    for the rest of the afternoon. Both now go through `usePoll`.
  */
  describe('the other poller', () => {
    it('does not run a bare interval', () => {
      expect(panel).not.toContain('setInterval');
    });

    it('polls through the shared timer, which skips hidden tabs', () => {
      expect(panel).toMatch(/usePoll\(load, \{ everyMs: 60_000, enabled: Boolean\(orgId && token\) \}\)/);
    });

    /** A tick is a background request; the first load is not. */
    it('marks its ticks as background and nothing else', () => {
      expect(panel).toMatch(/const load = useCallback\(async \(background = false\)/);
      expect(panel).toMatch(/happeningNow\(orgId, token, background\)/);
    });
  });
});

/*
  The sanitiser's own tests moved to `sanitizer-loads.spec.ts` (OPS-35).

  This asserted `serverExternalPackages: ['isomorphic-dompurify']`, which was
  the OPS-09 attempt at the ENOENT: stop Next bundling jsdom so the stylesheet
  it reads would be traced in beside it. It worked, in the sense that the file
  arrived — and the sanitiser still threw, now on an ESM-only dependency being
  required from CommonJS.

  The library is gone and the setting with it, so there is nothing here left
  to assert. What that test was really for — that the sanitiser can load
  inside the function — is now checked by requiring it in a real Node process
  and by walking its dependencies for ESM, which is what would have caught
  the second failure before it shipped.
*/
