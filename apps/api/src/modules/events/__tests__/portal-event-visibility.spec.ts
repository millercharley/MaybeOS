import { EventsService } from '../events.service';

/**
 * Which events a co-op's portal shows, and to whom.
 *
 * `create` defaults a new event to **MEMBERS_ONLY**, and the portal listing
 * asked for **PUBLIC** regardless of who was looking. So a co-op creating an
 * event the ordinary way produced one that was invisible on its own portal, to
 * its own members — the page read as empty rather than as restricted, which is
 * the worst version: nothing tells you the event exists, so the reasonable
 * conclusion is that events are broken.
 *
 * Found on 2026-08-18 with the first real event MaybeItsFate created.
 *
 * The two rules worth holding still:
 *   1. a member of this co-op sees PUBLIC and MEMBERS_ONLY
 *   2. everyone else sees PUBLIC only, and PRIVATE is listed for nobody
 */
describe('EventsService — what the portal lists', () => {
  const whereFrom = async (viewerIsMember?: boolean) => {
    const captured: Record<string, unknown>[] = [];
    const prisma = {
      // The service runs findMany and count inside $transaction; both receive
      // the same `where`, which is the thing under test.
      $transaction: async (ops: unknown[]) => [[], ops.length],
      event: {
        findMany: (args: { where: Record<string, unknown> }) => {
          captured.push(args.where);
          return [];
        },
        count: (args: { where: Record<string, unknown> }) => {
          captured.push(args.where);
          return 0;
        },
      },
    };

    const service = new EventsService(prisma as never, {} as never, {} as never);
    await service.listPublicEvents('org-1', {}, viewerIsMember);
    return captured[0];
  };

  it('shows a member the co-op’s members-only events, not just the public ones', async () => {
    expect((await whereFrom(true)).visibility).toEqual({ in: ['PUBLIC', 'MEMBERS_ONLY'] });
  });

  it('shows an anonymous visitor only what the co-op made public', async () => {
    expect((await whereFrom(false)).visibility).toBe('PUBLIC');
  });

  it('defaults to the anonymous rule when nobody says otherwise', async () => {
    // A caller that forgets the flag must get the narrow answer, never the
    // wide one — the failure should be an event missing, not one leaked.
    expect((await whereFrom()).visibility).toBe('PUBLIC');
  });

  it('never lists PRIVATE, for anyone', async () => {
    for (const viewer of [true, false, undefined]) {
      const visibility = (await whereFrom(viewer)).visibility;
      expect(JSON.stringify(visibility)).not.toContain('PRIVATE');
    }
  });

  it('still hides drafts and cancellations from both', async () => {
    for (const viewer of [true, false]) {
      const where = await whereFrom(viewer);
      expect(where.isPublished).toBe(true);
      expect(where.canceledAt).toBeNull();
    }
  });
});
