import { EventsService } from '../events.service';
import { NotFoundException } from '@nestjs/common';

/**
 * What a co-op's website is allowed to read.
 *
 * This is the one route in MaybeOS that answers to any origin, so what it
 * returns is a promise about what a co-op publishes rather than an
 * implementation detail. The app's CORS is otherwise locked to its own domains
 * and sends credentials, which is why a Webflow site cannot read the ordinary
 * endpoints and should not be able to.
 *
 * Two things this pins:
 *   1. it shows only what the co-op has already made public
 *   2. it returns the smallest payload that renders a listing, so widening the
 *      event model later cannot quietly start publishing more than a co-op
 *      agreed to
 */
describe('EventsService — the website embed', () => {
  const org = { id: 'org-1', name: 'MaybeItsFate', slug: 'maybeitsfate' };

  const build = (overrides: Record<string, unknown> = {}) => {
    const captured: Record<string, unknown>[] = [];
    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue(org) },
      $transaction: async (ops: unknown[]) => [await ops[0], 1],
      event: {
        findMany: (args: { where: Record<string, unknown> }) => {
          captured.push(args.where);
          return [
            {
              id: 'internal-id',
              title: 'Repair Café',
              slug: 'repair-cafe',
              description: 'Bring something broken.',
              startTime: new Date('2126-09-01T18:00:00Z'),
              endTime: new Date('2126-09-01T20:00:00Z'),
              priceCents: 1000,
              currency: 'usd',
              location: { name: 'The Workshop' },
              room: null,
              hostId: 'user-secret',
              _count: { rsvps: 12 },
            },
          ];
        },
        count: () => 1,
      },
      ...overrides,
    };

    return { service: new EventsService(prisma as never, {} as never, {} as never), captured };
  };

  it('asks only for public, published, uncancelled events', async () => {
    const { service, captured } = build();
    await service.listEmbedEvents('maybeitsfate');

    expect(captured[0]).toMatchObject({
      orgId: 'org-1',
      visibility: 'PUBLIC',
      isPublished: true,
      canceledAt: null,
    });
  });

  it('returns what a listing needs', async () => {
    const { service } = build();
    const result = await service.listEmbedEvents('maybeitsfate');

    expect(result.org).toEqual({ name: 'MaybeItsFate', slug: 'maybeitsfate' });
    expect(result.events[0]).toMatchObject({
      title: 'Repair Café',
      location: 'The Workshop',
      priceCents: 1000,
    });
  });

  it('publishes nothing beyond it', async () => {
    // The failure this prevents is silent: a field added to Event later
    // appears on every co-op's public website without anyone deciding it
    // should. Listing the shape here forces that to be a choice.
    const { service } = build();
    const result = await service.listEmbedEvents('maybeitsfate');

    expect(Object.keys(result.events[0]).sort()).toEqual(
      ['currency', 'description', 'endTime', 'location', 'priceCents', 'slug', 'startTime', 'title'],
    );
  });

  it('refuses a slug that is not a co-op', async () => {
    const { service } = build({ organization: { findUnique: jest.fn().mockResolvedValue(null) } });

    await expect(service.listEmbedEvents('not-a-co-op')).rejects.toBeInstanceOf(NotFoundException);
  });
});
