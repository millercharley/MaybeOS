import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safePath } from '../lib/api';

/**
 * How the event detail page finds its event (EVT-52).
 *
 * It used to read the member list and search it for a matching slug:
 *
 *     api.events.listVisible(org.id, token)
 *       .then((all) => all.find((e) => e.slug === eventSlug))
 *       .then((found) => found ?? api.events.getPublicBySlug(...))
 *
 * `listVisible` is a *page* — twenty rows, ordered by start time ascending,
 * with no `from` filter — so that searched the twenty oldest events the co-op
 * ever held. MaybeItsFate has 793 visible events. The two Charley reported sat
 * at rows 605 and 606, so `.find` returned undefined, the fallback asked the
 * public endpoint, and the public endpoint correctly refuses a members-only
 * event. 739 of 793 events read "Event not found" to the members who own them.
 *
 * The bug is a *shape*, not a number: finding one record by scanning one page
 * of a list is wrong at any page size, and raising the page size would only
 * move the cliff. So what this pins is the shape.
 */
describe('the event detail page asks for one event', () => {
  const PAGE = readFileSync(
    join(__dirname, '..', 'app/(app)/portal/[orgSlug]/events/[eventSlug]/page.tsx'),
    'utf8',
  );

  // Comments blanked before scanning, line breaks kept. The page's own
  // comment quotes the bad code it replaced — a scan that matched prose would
  // fail the moment somebody documented the fix, and pass if somebody
  // reintroduced it.
  const CODE = stripComments(PAGE);

  it('reads the member endpoint by slug', () => {
    expect(CODE).toMatch(/api\.events\.getBySlug\(org\.id,\s*eventSlug,\s*token\)/);
  });

  it('does not find its event by searching a list', () => {
    expect(CODE).not.toContain('listVisible');
    expect(CODE).not.toMatch(/\.find\(\s*\(e\w*\)\s*=>\s*e\w*\.slug/);
  });

  it('still lands a public link on the public read', () => {
    // A stranger following a shared link has no org id and no token, and that
    // path is the entire reason event links can be public.
    expect(CODE).toMatch(/:\s*api\.events\.getPublicBySlug\(orgSlug,\s*eventSlug\)/);
  });

  it('chooses the member read only for a member who is signed in', () => {
    expect(CODE).toMatch(/const read = isMember && org && token/);
  });
});

describe('the client method', () => {
  const API = stripComments(readFileSync(join(__dirname, '..', 'lib/api.ts'), 'utf8'));

  const BODY = (() => {
    const at = API.indexOf('getBySlug: (orgId: string, eventSlug: string, token: string)');
    expect(at).toBeGreaterThan(-1);
    return API.slice(at, at + 400);
  })();

  it('sends the token, because the route is guarded', () => {
    expect(BODY).toContain('{ token }');
  });

  it('encodes the slug it was handed', () => {
    expect(BODY).toContain('encodeURIComponent(eventSlug)');
  });

  it('groups as one route in Sentry rather than one issue per event', () => {
    // 793 events would otherwise be 793 issues. `safePath` already folds
    // `by-slug/<slug>`, which is why the path was shaped this way.
    expect(safePath('/orgs/abc/events/by-slug/improv-club-2026-11-06')).toBe(
      '/orgs/:org/events/by-slug/:slug',
    );
    expect(safePath('/orgs/abc/events/by-slug/improv-club-2026-11-06')).toBe(
      safePath('/orgs/abc/events/by-slug/2026-11-02-meditation-and-automatic-drawing-workshop'),
    );
  });
});
