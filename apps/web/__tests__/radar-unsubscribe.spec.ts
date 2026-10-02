import { readFileSync } from 'fs';
import { join } from 'path';
import { initialUnsubscribeState, stopRadarEmails } from '@/lib/radar-unsubscribe';

/**
 * The unsubscribe page, from the link at the foot of a Radar digest (RDR-01).
 *
 * Three things can happen to somebody who presses the button, and two of
 * them look alike from the outside while meaning opposite things: the API
 * answering `{ ok: false }` means the token was no good *and nothing was
 * changed*, and the request failing means nothing was changed either —
 * but one of those is a dead end and the other is worth pressing again.
 * Telling a member their emails have stopped when they have not is how an
 * unsubscribe becomes a spam complaint one week later.
 *
 * Run through the real client rather than a stub of it, so the URL, the
 * method and the token encoding are part of what is being tested — the
 * endpoint is a POST on purpose and that is not incidental.
 */
describe('stopping the Radar digest', () => {
  const realFetch = global.fetch;
  let seen: { url: string; method?: string };

  /** Stand in for the API with one answer. */
  function apiAnswers(body: unknown) {
    global.fetch = jest.fn(async (url: unknown, init?: { method?: string }) => {
      seen = { url: String(url), method: init?.method };
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    seen = { url: '' };
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  describe('a link that worked', () => {
    it('confirms, and names the co-op so the member knows what stopped', async () => {
      apiAnswers({ ok: true, orgName: 'MaybeItsFate' });

      const state = await stopRadarEmails('signed-token');

      expect(state).toEqual({ kind: 'stopped', orgName: 'MaybeItsFate' });
    });

    it('asks the API to stop them, as a POST', async () => {
      // A GET here would let a mail scanner unsubscribe a member who never
      // opened the email — which is why the endpoint is a POST and why the
      // page has a button at all.
      apiAnswers({ ok: true, orgName: 'MaybeItsFate' });

      await stopRadarEmails('a token/with+punctuation');

      expect(seen.method).toBe('POST');
      expect(seen.url).toContain('/radar/unsubscribe?token=a%20token%2Fwith%2Bpunctuation');
    });
  });

  describe('a link that did not work', () => {
    it('reads as a bad link when the API refuses the token', async () => {
      // `{ ok: false }` covers a forged token and a membership that is gone.
      // The API gives one answer to both on purpose, and so does the page.
      apiAnswers({ ok: false });

      expect(await stopRadarEmails('stale-token')).toEqual({ kind: 'badLink' });
    });

    it('says so before asking the API, when there is no token at all', async () => {
      // A link copied out of a mail client by hand loses the query string
      // often enough to be worth its own answer — and a round trip that was
      // always going to fail is a round trip a member waits through.
      apiAnswers({ ok: true, orgName: 'MaybeItsFate' });

      expect(await stopRadarEmails(null)).toEqual({ kind: 'badLink' });
      expect(await stopRadarEmails('')).toEqual({ kind: 'badLink' });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('opens on the bad-link state when the address carries no token', () => {
      expect(initialUnsubscribeState(null)).toEqual({ kind: 'badLink' });
      expect(initialUnsubscribeState('signed-token')).toEqual({ kind: 'asking' });
    });
  });

  describe('a request that never landed', () => {
    it('offers another go rather than claiming the emails stopped', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      expect(await stopRadarEmails('signed-token')).toEqual({ kind: 'failed' });
    });

    it('does the same when the API answers with an error', async () => {
      // A 500 is not a bad link. The member is still subscribed either way,
      // and flattening the two would tell them it worked.
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 500,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Internal server error' }),
        text: async () => '{}',
      })) as unknown as typeof fetch;

      expect(await stopRadarEmails('signed-token')).toEqual({ kind: 'failed' });
    });
  });
});

/**
 * The rule the whole design rests on, asserted against the page itself.
 *
 * Mail clients, link previewers and corporate security products fetch every
 * URL in a message before a human sees it. If this page ever unsubscribes on
 * load, members get switched off without touching anything and the only
 * evidence is a digest nobody receives. The API refusing GET is the real
 * defense; this catches the version of the mistake that still compiles —
 * calling `stopRadarEmails` from an effect.
 */
describe('the unsubscribe page', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app', 'radar', 'unsubscribe', 'page.tsx'),
    'utf8',
  );

  it('never unsubscribes on load', () => {
    expect(source).not.toMatch(/useEffect/);
  });

  it('unsubscribes from a button the member presses', () => {
    expect(source).toMatch(/onClick=\{stop\}/);
  });
});
