import { readFileSync } from 'fs';
import { join } from 'path';
import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';

/**
 * The member dashboard asks once (OPS-46).
 *
 * Measured on a production build on 2026-11-19, opening it made sixteen
 * requests to the API. `next dev` could not answer the question — StrictMode
 * invokes every effect twice — which is why the number in the card was a
 * guess for weeks.
 *
 * Ten of the sixteen were this page's own panels, and in production `/api/*`
 * is same-origin, so ten requests are ten Netlify Function invocations on
 * Micro compute every time a member opens the app. Charley's note on the
 * compute card: "Better to make our code more efficient."
 *
 * These tests exist because the fan-out is the *easy* thing to write. Adding
 * a panel with its own `useApi` is one line and looks like every other
 * component in the app; it is how the page got to ten.
 */
const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

/**
 * Comments explain the rule, so a scan that reads them proves nothing. The
 * API has `common/testing/source-scan.ts` for this; the web app's specs do it
 * inline, and this is the same walk — blanking rather than deleting, so line
 * numbers in a failure still point at the file on disk.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'tick' = 'code';

  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i];

    if (state === 'code') {
      if (two === '//') { state = 'line'; out += '  '; i += 2; continue; }
      if (two === '/*') { state = 'block'; out += '  '; i += 2; continue; }
      if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'tick';
      out += ch; i += 1; continue;
    }

    if (state === 'line') {
      if (ch === '\n') { state = 'code'; out += ch; } else out += ' ';
      i += 1; continue;
    }

    if (state === 'block') {
      if (two === '*/') { state = 'code'; out += '  '; i += 2; continue; }
      out += ch === '\n' ? ch : ' ';
      i += 1; continue;
    }

    // Inside a string: copy it, and leave on the closing quote. An escape
    // takes the next character with it, so `'\''` does not end here.
    if (ch === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
    if (
      (state === 'single' && ch === "'") ||
      (state === 'double' && ch === '"') ||
      (state === 'tick' && ch === '`')
    ) {
      state = 'code';
    }
    out += ch; i += 1;
  }

  return out;
}

describe('the member dashboard makes one request for its panels', () => {
  const page = stripComments(
    read('app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'page.tsx'),
  );

  it('calls useApi exactly once', () => {
    expect(page.match(/useApi\(/g)).toHaveLength(1);
  });

  it('and that call is the bundle', () => {
    expect(page).toMatch(/api\.dashboard\.memberHome\(/);
  });

  /*
    The four it used to make itself. Named individually rather than asserting
    "no api.* calls", because the point is not that the page never talks to
    the API — it is that these four answers now come from the bundle and
    asking for them twice would be the fan-out growing back one line at a
    time.
  */
  it.each([
    ['rooms.myBookings'],
    ['events.myRsvps'],
    ['events.listVisible'],
    ['dashboard.memberStats'],
  ])('does not also ask for %s on its own', (call) => {
    expect(page).not.toMatch(new RegExp(`api\\.${call.replace('.', '\\.')}\\(`));
  });
});

describe('the panels take their data rather than fetching it', () => {
  /*
    Each of these renders only on the member dashboard — checked before the
    change, and the reason props were the right answer rather than a context.
    `useRecentJoins` is the exception and stays a hook, because the Commons
    uses it too, where arrivals are placed one at a time in the conversation
    and there is no bundle to take them from.
  */
  it.each([
    ['components/member/member-spotlight.tsx'],
    ['components/member/door-code-card.tsx'],
    ['components/member/interest-prompt.tsx'],
    ['components/member/teaching-showcase.tsx'],
    ['components/service/serving-today.tsx'],
    ['components/live/welcome-card.tsx'],
  ])('%s does not fetch what the dashboard already holds', (file) => {
    const source = stripComments(read(...file.split('/')));

    expect(source).not.toMatch(/useApi\(/);
    expect(source).not.toMatch(/api\.members\.spotlight\(/);
    expect(source).not.toMatch(/api\.door\.myPin\(/);
    expect(source).not.toMatch(/api\.radar\.ask\(/);
    expect(source).not.toMatch(/api\.teaching\.list\(/);
    expect(source).not.toMatch(/api\.service\.mine\(/);
    expect(source).not.toMatch(/api\.dashboard\.recentJoins\(/);
  });

  /*
    `InterestPrompt` still writes — "yes", "not for me" and "not now" are all
    posts — so this is about reads only. A test that banned `api.` outright
    would have forced that component to take callbacks for no reason.
  */
  it('leaves the interest prompt able to answer', () => {
    const source = stripComments(read('components', 'member', 'interest-prompt.tsx'));

    expect(source).toMatch(/api\.radar\.setInterests\(/);
    expect(source).toMatch(/api\.radar\.dismissAsk\(/);
  });
});

describe('the profile is fetched once per load, not twice', () => {
  /*
    `init` reads the token from localStorage, sets it, and calls
    `loadProfile`. `AuthProvider` then has a second effect — `if (token &&
    !user) loadProfile()` — which sees precisely that state, because the first
    call has not returned. Two of the dashboard's sixteen requests were this
    one request, on every cold load of every page in the app.
  */
  const profile = { id: 'u1', name: 'Alex', orgs: [] };

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: 't', user: null, currentOrgId: null, isLoading: true });
  });

  it('shares one request between callers that overlap', async () => {
    let calls = 0;
    const spy = jest
      .spyOn(api.auth, 'profile')
      .mockImplementation(() => {
        calls += 1;
        return new Promise((resolve) => setTimeout(() => resolve(profile as never), 5));
      });

    const { loadProfile } = useAuthStore.getState();
    await Promise.all([loadProfile(), loadProfile(), loadProfile()]);

    expect(calls).toBe(1);
    // Every caller waited for the real answer, rather than returning early
    // with the stale user. `join` and `invite` both read the store straight
    // after awaiting this.
    expect(useAuthStore.getState().user).toEqual(profile);
    spy.mockRestore();
  });

  it('lets the next caller try again once the first has finished', async () => {
    const spy = jest.spyOn(api.auth, 'profile').mockResolvedValue(profile as never);

    const { loadProfile } = useAuthStore.getState();
    await loadProfile();
    await loadProfile();

    // Not a cache: a tab coming back, or a member who has just accepted an
    // invitation, must get a fresh answer.
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('does not strand later callers when the request fails', async () => {
    const spy = jest
      .spyOn(api.auth, 'profile')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(profile as never);

    const { loadProfile } = useAuthStore.getState();
    await loadProfile();
    expect(useAuthStore.getState().user).toBeNull();

    await loadProfile();
    expect(useAuthStore.getState().user).toEqual(profile);
    spy.mockRestore();
  });
});
