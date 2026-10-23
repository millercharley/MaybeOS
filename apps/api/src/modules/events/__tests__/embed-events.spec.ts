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
  // PLUS ($0.30) with a $1.45 venue fee, like MaybeItsFate's: the embed quotes
  // what Stripe will charge, so the plan and the co-op's own fee are part of
  // the payload's correctness (EVT-48).
  const org = {
    id: 'org-1',
    name: 'MaybeItsFate',
    slug: 'maybeitsfate',
    plan: 'PLUS',
    ticketFeeCents: 145,
  };

  const build = (overrides: Record<string, unknown> = {}) => {
    const captured: Record<string, unknown>[] = [];
    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue(org) },
      // Interactive form as well as the array form (SEC-12).
      $transaction: async (arg: any) =>
        Array.isArray(arg) ? [await arg[0], 1] : arg(prisma),
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
              imageUrl: 'https://cdn.example.com/poster.jpg',
              imageFocusY: 20,
              maturityLevel: 'AGES_18_PLUS',
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

    const config = { get: (key: string) => (key === 'APP_URL' ? 'https://maybeos.org' : undefined) };

    return {
      service: new EventsService(
        prisma as never,
        {} as never,
        {} as never,
        config as never,
        {} as never,
      ),
      captured,
    };
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

  /**
   * What the embed needs to look like the list members see (EVT-48).
   *
   * Charley: "the embed does not include buttons to learn more about an event
   * or to get tickets. I would like for the event list to look the same as
   * the one members see."
   */
  it('carries the poster, the age badge and somewhere to press', async () => {
    const { service } = build();
    const result = await service.listEmbedEvents('maybeitsfate');

    expect(result.events[0]).toMatchObject({
      imageUrl: 'https://cdn.example.com/poster.jpg',
      imageFocusY: 20,
      maturityLevel: 'AGES_18_PLUS',
      url: 'https://maybeos.org/portal/maybeitsfate/events/repair-cafe',
    });
  });

  /**
   * The embed quotes money to a stranger who then gets charged. It printed
   * the face value, so a $10 ticket advertised $10 and rang up $11.75.
   */
  it('quotes what the buyer will actually pay, fees and all', async () => {
    const { service } = build();
    const result = await service.listEmbedEvents('maybeitsfate');

    // $10 + $0.30 MaybeOS (PLUS) + $1.45 venue.
    expect(result.events[0].totalCents).toBe(1175);
    // The face value stays too — it is what the co-op set, and a renderer may
    // want to say so.
    expect(result.events[0].priceCents).toBe(1000);
  });

  it('leaves a free event with no total to quote', async () => {
    const { service } = build({
      event: {
        findMany: () => [
          {
            title: 'Open Studio',
            slug: 'open-studio',
            description: null,
            startTime: new Date('2126-09-01T18:00:00Z'),
            endTime: new Date('2126-09-01T20:00:00Z'),
            priceCents: null,
            currency: 'usd',
            location: null,
            room: null,
            _count: { rsvps: 0 },
          },
        ],
        count: () => 1,
      },
    });

    const result = await service.listEmbedEvents('maybeitsfate');

    expect(result.events[0].priceCents).toBeNull();
    expect(result.events[0].totalCents).toBeNull();
  });

  /**
   * The line that must not move (SEC-12).
   *
   * The member list's hero shows faces and "2 people going". This does not,
   * and must never: an event link may be public so strangers can RSVP, but
   * who is attending is not — a row of a co-op's members' faces on their own
   * marketing site tells anybody with the URL who belongs to it.
   */
  it('never publishes who is coming', async () => {
    const { service } = build();
    const keys = Object.keys((await service.listEmbedEvents('maybeitsfate')).events[0]);

    expect(keys).not.toContain('rsvpCount');
    expect(keys).not.toContain('rsvpFaces');
    expect(keys).not.toContain('rsvps');
    expect(keys).not.toContain('hostId');
  });

  it('publishes nothing beyond it', async () => {
    // The failure this prevents is silent: a field added to Event later
    // appears on every co-op's public website without anyone deciding it
    // should. Listing the shape here forces that to be a choice.
    const { service } = build();
    const result = await service.listEmbedEvents('maybeitsfate');

    expect(Object.keys(result.events[0]).sort()).toEqual([
      'currency',
      'description',
      'endTime',
      'imageFocusY',
      'imageUrl',
      'location',
      'maturityLevel',
      'priceCents',
      'slug',
      'startTime',
      'title',
      'totalCents',
      'url',
    ]);
  });

  /**
   * A listing and a charge have opposite duties.
   *
   * `priceTicket` throws on a price that is not a positive whole number of
   * cents, which is right when it is about to take money and wrong here: one
   * odd row would 500 the whole route and leave a blank section on the
   * co-op's marketing site — their domain, our fault, no error anybody sees.
   */
  it.each([
    ['zero', 0],
    ['negative', -500],
    ['fractional', 10.5],
    ['missing', undefined],
  ])('still lists an event whose price is %s', async (_label, priceCents) => {
    const { service } = build({
      event: {
        findMany: () => [
          {
            title: 'Odd One',
            slug: 'odd-one',
            description: null,
            startTime: new Date('2126-09-01T18:00:00Z'),
            endTime: new Date('2126-09-01T20:00:00Z'),
            priceCents,
            currency: 'usd',
            location: null,
            room: null,
            _count: { rsvps: 0 },
          },
        ],
        count: () => 1,
      },
    });

    const result = await service.listEmbedEvents('maybeitsfate');

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Odd One');
    expect(result.events[0].totalCents).toBeNull();
  });

  it('refuses a slug that is not a co-op', async () => {
    const { service } = build({ organization: { findUnique: jest.fn().mockResolvedValue(null) } });

    await expect(service.listEmbedEvents('not-a-co-op')).rejects.toBeInstanceOf(NotFoundException);
  });
});
