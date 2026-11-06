import { readSource } from '../../../common/testing/source-scan';
import { EventsService } from '../events.service';

/**
 * Reading one event by its slug, as a member (EVT-52).
 *
 * The detail page had no endpoint for this. It fetched the first page of the
 * member list and searched it for a matching slug — twenty rows, ordered by
 * start time ascending, with no `from` filter, so it was searching the twenty
 * *oldest* events the co-op ever held. MaybeItsFate has 793 visible events;
 * the two Charley reported sat at rows 605 and 606.
 *
 * `.find` returned undefined, the fallback asked the public by-slug endpoint,
 * and that endpoint correctly refuses a members-only event. So a member
 * clicking their own co-op's event read "Event not found" — for 739 of 793
 * events. The ones that worked were public, rescued by the fallback, which is
 * what made it look like an arbitrary subset.
 *
 * What has to hold now that one event can be fetched directly:
 *   1. it is looked up by key, never by scanning a page of rows
 *   2. the predicate matches what the member *list* would have shown, so
 *      fixing reachability did not widen what a member can read
 *   3. the org comes from the guarded path, so a slug cannot cross tenants
 */
describe('EventsService.getMemberEventBySlug', () => {
  const EVENT = {
    id: 'evt-1',
    orgId: 'org-1',
    slug: 'improv-club-2026-11-06',
    title: 'Improv Club',
    isPublished: true,
    canceledAt: null,
    visibility: 'MEMBERS_ONLY',
    hostName: 'Someone',
    _count: { rsvps: 3 },
    rsvps: [{ user: { id: 'u1', name: 'A', avatarPath: null } }],
  };

  const serviceFor = (row: unknown) => {
    const calls: Array<Record<string, unknown>> = [];
    const prisma = {
      event: {
        findUnique: (args: Record<string, unknown>) => {
          calls.push(args);
          return row;
        },
        // Present and loud: a by-slug read that reaches for a list is the
        // bug this replaces.
        findMany: () => {
          throw new Error('getMemberEventBySlug must not scan a list');
        },
      },
    };
    const service = new EventsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, calls };
  };

  it('finds the event by its org-and-slug key', async () => {
    const { service, calls } = serviceFor(EVENT);
    await service.getMemberEventBySlug('org-1', 'improv-club-2026-11-06');

    expect(calls).toHaveLength(1);
    expect(calls[0].where).toEqual({
      orgId_slug: { orgId: 'org-1', slug: 'improv-club-2026-11-06' },
    });
  });

  it('reaches an event the paginated list would never have contained', async () => {
    // The whole point: row 606 of 793 is as reachable as row 1, because the
    // lookup does not depend on where the event falls in an ordering.
    const { service } = serviceFor(EVENT);
    await expect(
      service.getMemberEventBySlug('org-1', 'improv-club-2026-11-06'),
    ).resolves.toMatchObject({ slug: 'improv-club-2026-11-06' });
  });

  it('returns a members-only event to a member', async () => {
    const { service } = serviceFor(EVENT);
    await expect(
      service.getMemberEventBySlug('org-1', 'improv-club-2026-11-06'),
    ).resolves.toMatchObject({ visibility: 'MEMBERS_ONLY' });
  });

  it('returns a public event through the same route', async () => {
    const { service } = serviceFor({ ...EVENT, visibility: 'PUBLIC' });
    await expect(service.getMemberEventBySlug('org-1', 'x')).resolves.toBeTruthy();
  });

  it('carries the host, which is why a member does not use the public read', async () => {
    const { service } = serviceFor(EVENT);
    await expect(service.getMemberEventBySlug('org-1', 'x')).resolves.toMatchObject({
      hostName: 'Someone',
    });
  });

  it('maps the counts and faces the member list maps', async () => {
    const { service } = serviceFor(EVENT);
    const event = (await service.getMemberEventBySlug('org-1', 'x')) as Record<string, unknown>;

    expect(event.rsvpCount).toBe(3);
    expect(event.rsvpFaces).toEqual([{ id: 'u1', name: 'A', avatarPath: null }]);
    // The raw relation keys do not travel; the page reads the mapped ones.
    expect(event._count).toBeUndefined();
    expect(event.rsvps).toBeUndefined();
  });

  it('asks for the relations the member list asks for', async () => {
    const { service, calls } = serviceFor(EVENT);
    await service.getMemberEventBySlug('org-1', 'x');

    const include = calls[0].include as Record<string, unknown>;
    expect(include.location).toBe(true);
    expect(include.room).toBe(true);
    expect(include._count).toBeDefined();
    expect(include.rsvps).toBeDefined();
  });

  it('404s an event that is not there', async () => {
    const { service } = serviceFor(null);
    await expect(service.getMemberEventBySlug('org-1', 'nope')).rejects.toThrow(
      'Event not found',
    );
  });

  /*
    The three the list predicate excludes. Reachability was the bug; what a
    member is allowed to read did not change, so each of these must still
    answer exactly as the list did — by omitting the event.
  */
  it('404s a draft', async () => {
    const { service } = serviceFor({ ...EVENT, isPublished: false });
    await expect(service.getMemberEventBySlug('org-1', 'x')).rejects.toThrow('Event not found');
  });

  it('404s a cancelled event', async () => {
    const { service } = serviceFor({ ...EVENT, canceledAt: new Date() });
    await expect(service.getMemberEventBySlug('org-1', 'x')).rejects.toThrow('Event not found');
  });

  it('404s a PRIVATE event, which is listed for nobody', async () => {
    const { service } = serviceFor({ ...EVENT, visibility: 'PRIVATE' });
    await expect(service.getMemberEventBySlug('org-1', 'x')).rejects.toThrow('Event not found');
  });

  it('says only "not found", so a slug cannot be probed for what exists', async () => {
    // A draft and a missing event must be indistinguishable from outside.
    const missing = serviceFor(null);
    const draft = serviceFor({ ...EVENT, isPublished: false });

    const messages = await Promise.all(
      [missing, draft].map(({ service }) =>
        service.getMemberEventBySlug('org-1', 'x').then(
          () => 'resolved',
          (err: Error) => err.message,
        ),
      ),
    );
    expect(messages[0]).toBe(messages[1]);
  });
});

describe('the by-slug route is scoped to the org in its path', () => {
  // Comments stripped before scanning: this file's own prose names every
  // guard it is checking for, and a scan that matches a comment proves
  // nothing. Line breaks are preserved so a failure still points at a
  // line.
  const read = (file: string) => readSource(__dirname, '..', file);

  const CONTROLLER = read('events.controller.ts');
  const SERVICE = read('events.service.ts');

  const route = () => {
    const at = CONTROLLER.indexOf("@Get('orgs/:orgId/events/by-slug/:eventSlug')");
    expect(at).toBeGreaterThan(-1);
    return CONTROLLER.slice(at, at + 700);
  };

  it('is declared, and under the org', () => {
    expect(route()).toContain('getMemberEventBySlug');
  });

  it('requires a signed-in member of that org', () => {
    expect(route()).toMatch(/@UseGuards\(JwtAuthGuard,\s*OrgMembershipGuard\)/);
  });

  it('takes the org from the path rather than the body or a query', () => {
    expect(route()).toMatch(/@Param\('orgId',\s*ParseUUIDPipe\)\s*orgId/);
  });

  it('is declared before the route that would swallow it', () => {
    // `orgs/:orgId/events/:eventId` is a single segment and this is two, so
    // they cannot collide — but ordering is the cheap guarantee, and Nest
    // matches in declaration order.
    const mine = CONTROLLER.indexOf("@Get('orgs/:orgId/events/by-slug/:eventSlug')");
    const generic = CONTROLLER.indexOf("@Get('orgs/:orgId/events/:eventId')");
    expect(mine).toBeLessThan(generic);
  });

  it('never takes an org from the slug it was given', () => {
    const at = SERVICE.indexOf('async getMemberEventBySlug(');
    expect(at).toBeGreaterThan(-1);
    const body = SERVICE.slice(at, SERVICE.indexOf('\n  }', at));

    // No organization lookup in here: the public route resolves an org slug
    // because it has nothing better, and borrowing that would mean a member
    // of one co-op could name another.
    expect(body).not.toContain('organization.findUnique');
    expect(body).toContain('orgId_slug: { orgId, slug: eventSlug }');
  });
});
