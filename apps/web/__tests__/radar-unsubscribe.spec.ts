import { readFileSync } from 'fs';
import { join } from 'path';
import {
  initialUnsubscribeState,
  stopEmails,
  unsubscribeCopy,
} from '@/lib/radar-unsubscribe';

/**
 * The unsubscribe page, from the link at the foot of an email MaybeOS sends
 * (RDR-01, RCP-01).
 *
 * Three things can happen to somebody who presses the button, and two of
 * them look alike from the outside while meaning opposite things: the API
 * answering `{ ok: false }` means the token was no good *and nothing was
 * changed*, and the request failing means nothing was changed either —
 * but one of those is a dead end and the other is worth pressing again.
 * Telling a member their emails have stopped when they have not is how an
 * unsubscribe becomes a spam complaint one week later.
 *
 * One route now serves two emails, which adds a fourth way to be wrong: a
 * member who stopped the monthly recap being told the weekly digest has
 * stopped. That is a false statement about their own mailbox, and the page
 * cannot even make it honestly — the token is not decoded until the POST.
 *
 * Run through the real client rather than a stub of it, so the URL, the
 * method and the token encoding are part of what is being tested — the
 * endpoint is a POST on purpose and that is not incidental.
 */
describe('stopping an email MaybeOS sends', () => {
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
    it('confirms, and carries the co-op and which email this was', async () => {
      apiAnswers({ ok: true, orgName: 'MaybeItsFate', purpose: 'recap' });

      const state = await stopEmails('signed-token');

      expect(state).toEqual({ kind: 'stopped', orgName: 'MaybeItsFate', purpose: 'recap' });
    });

    it('keeps no purpose it does not recognize', async () => {
      // A purpose this page has never heard of is a purpose it cannot name in
      // a sentence, and guessing would name the wrong email.
      apiAnswers({ ok: true, orgName: 'MaybeItsFate', purpose: 'dues' });

      expect(await stopEmails('signed-token')).toEqual({
        kind: 'stopped',
        orgName: 'MaybeItsFate',
        purpose: undefined,
      });
    });

    it('asks the API to stop them, as a POST', async () => {
      // A GET here would let a mail scanner unsubscribe a member who never
      // opened the email — which is why the endpoint is a POST and why the
      // page has a button at all.
      apiAnswers({ ok: true, orgName: 'MaybeItsFate', purpose: 'radar' });

      await stopEmails('a token/with+punctuation');

      expect(seen.method).toBe('POST');
      expect(seen.url).toContain('/radar/unsubscribe?token=a%20token%2Fwith%2Bpunctuation');
    });
  });

  describe('a link that did not work', () => {
    it('reads as a bad link when the API refuses the token', async () => {
      // `{ ok: false }` covers a forged token and a membership that is gone.
      // The API gives one answer to both on purpose, and so does the page.
      apiAnswers({ ok: false });

      expect(await stopEmails('stale-token')).toEqual({ kind: 'badLink' });
    });

    it('says so before asking the API, when there is no token at all', async () => {
      // A link copied out of a mail client by hand loses the query string
      // often enough to be worth its own answer — and a round trip that was
      // always going to fail is a round trip a member waits through.
      apiAnswers({ ok: true, orgName: 'MaybeItsFate', purpose: 'radar' });

      expect(await stopEmails(null)).toEqual({ kind: 'badLink' });
      expect(await stopEmails('')).toEqual({ kind: 'badLink' });
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

      expect(await stopEmails('signed-token')).toEqual({ kind: 'failed' });
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

      expect(await stopEmails('signed-token')).toEqual({ kind: 'failed' });
    });
  });
});

/**
 * The words, which are the whole of what a member gets out of this page.
 *
 * Both emails come through one route, so every sentence is either about the
 * right one or about a mailbox the member does not have.
 */
describe('what the page says', () => {
  const namesDigest = (text: string) => /radar/i.test(text);
  const namesRecap = (text: string) => /recap/i.test(text);

  it('names the weekly digest when that is what stopped', () => {
    const copy = unsubscribeCopy({
      kind: 'stopped',
      orgName: 'MaybeItsFate',
      purpose: 'radar',
    });

    expect(copy.body).toContain('MaybeItsFate');
    expect(namesDigest(copy.body)).toBe(true);
    expect(namesRecap(copy.body)).toBe(false);
  });

  it('names the monthly recap when that is what stopped', () => {
    const copy = unsubscribeCopy({
      kind: 'stopped',
      orgName: 'MaybeItsFate',
      purpose: 'recap',
    });

    expect(copy.body).toContain('MaybeItsFate');
    expect(namesRecap(copy.body)).toBe(true);
    expect(namesDigest(copy.body)).toBe(false);
  });

  it('names neither when the API did not say which it was', () => {
    // An older API than this page. "That email" is vague; naming the wrong
    // one is false, and only one of those is recoverable.
    const copy = unsubscribeCopy({ kind: 'stopped' });

    expect(copy.body).toContain('Your co-op');
    expect(namesDigest(copy.body)).toBe(false);
    expect(namesRecap(copy.body)).toBe(false);
  });

  it('names both or neither before the button is pressed', () => {
    // The token is not decoded until the POST, so nothing on screen before it
    // can know which email the member is holding. Naming one of them there
    // would be a coin flip.
    for (const state of [{ kind: 'asking' } as const, { kind: 'stopping' } as const]) {
      const copy = unsubscribeCopy(state);
      expect(namesDigest(copy.body)).toBe(namesRecap(copy.body));
    }
  });

  it('does not claim anything stopped when the link or the request failed', () => {
    for (const state of [{ kind: 'badLink' } as const, { kind: 'failed' } as const]) {
      const copy = unsubscribeCopy(state);
      expect(namesDigest(copy.body)).toBe(namesRecap(copy.body));
      expect(copy.body).toMatch(/nothing has changed|haven’t\s+stopped/i);
    }
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
 * calling `stopEmails` from an effect.
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

  it('takes its wording from the one place that knows which email it was', () => {
    // Copy inlined in the page is copy that cannot branch on the purpose —
    // which is how a recap unsubscriber gets told about the Radar digest.
    expect(source).toMatch(/unsubscribeCopy\(state\)/);
  });
});
