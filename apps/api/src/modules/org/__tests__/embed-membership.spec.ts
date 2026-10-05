import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrgService } from '../org.service';
import { PrismaService } from '../../../config/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ForumService } from '../forum.service';
import { AuditService } from '../../platform/audit.service';

/**
 * The membership embed (PUB-01) — a co-op's tiers on their own website.
 *
 * The second route in MaybeOS that answers to any origin, so what it selects
 * is the whole of what it publishes. It shares `PUBLIC_TIER_SELECT` with the
 * join page for the reason MEM-14 exists: two selects drift, and the one that
 * drifts is the one nobody is looking at.
 */
describe('OrgService — the membership embed', () => {
  let service: OrgService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      // The strip above the prices (PUB-03): counted at load, so the service
      // asks for four numbers alongside the co-op itself.
      userOrg: { count: jest.fn().mockResolvedValue(437) },
      room: { count: jest.fn().mockResolvedValue(9) },
      event: { count: jest.fn().mockResolvedValue(21) },
      // A room booking is a private event (PUB-06), so the strip counts them.
      booking: { count: jest.fn().mockResolvedValue(173) },
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Sunrise',
          slug: 'sunrise',
          allowPublicJoin: true,
          tiers: [{ id: 't1', name: 'Sustainer' }],
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: ForumService, useValue: {} },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get<OrgService>(OrgService);
  });

  const selection = () => prisma.organization.findUnique.mock.calls[0][0].select;

  it('publishes the co-op’s name, slug and whether its doors are open', async () => {
    const result = await service.embedMembership('sunrise');

    expect(result.name).toBe('Sunrise');
    expect(result.allowPublicJoin).toBe(true);
  });

  it('publishes nothing else about the co-op', async () => {
    // The whole row is what leaks: Stripe account and subscription ids, the
    // billing waiver and its reason, suspension notes. A select, not a
    // redaction list — a column added tomorrow is absent from one and present
    // in the other.
    await service.embedMembership('sunrise');

    expect(Object.keys(selection()).sort()).toEqual([
      'allowPublicJoin',
      // Shown above the cards as the sentence about the place (PUB-03).
      'description',
      // Only to count against; stripped from what is returned.
      'id',
      'mission',
      'name',
      'slug',
      'tiers',
    ]);
  });

  it('asks for the same tier columns the public join page uses', async () => {
    await service.embedMembership('sunrise');

    const tierFields = Object.keys(selection().tiers.select).sort();
    expect(tierFields).toEqual([
      'benefits',
      'description',
      'highlightLabel',
      'id',
      'initiationFeeCents',
      'isPayWhatYouCan',
      'maxMembers',
      'minPrice',
      'name',
      'priceMonthly',
      'priceYearly',
      'serviceMinutes',
      'servicePeriod',
    ]);
    expect(tierFields).not.toContain('stripePriceIdMonthly');
  });

  it('shows only active tiers, in the order the admin set', async () => {
    await service.embedMembership('sunrise');

    expect(selection().tiers.where).toEqual({ isActive: true });
    expect(selection().tiers.orderBy).toEqual({ sortOrder: 'asc' });
  });

  it('404s for a slug that is not a co-op', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.embedMembership('nobody')).rejects.toThrow(NotFoundException);
  });
});

/**
 * What "this month" counts (PUB-06).
 *
 * Charley, seeing 18: "This is probably related to the system not reading the
 * Google Calendars that I imported for each room." Close — the imported
 * entries were in MaybeOS all along, as room bookings rather than events, and
 * the strip was counting only the latter. Of 174 bookings in that month, 173
 * had come from a room's Google calendar.
 *
 * And: "we're calling a room booking a private event for marketing purposes",
 * which is what makes "total events" the right label for a number that
 * includes them.
 */
describe('OrgService — what the month counts', () => {
  const build = (over: { events?: number; bookings?: number } = {}) => {
    const prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'org-1',
          name: 'MaybeItsFate',
          slug: 'maybeitsfate',
          mission: null,
          description: null,
          allowPublicJoin: true,
          tiers: [],
        }),
      },
      userOrg: { count: jest.fn().mockResolvedValue(436) },
      room: { count: jest.fn().mockResolvedValue(9) },
      event: { count: jest.fn().mockResolvedValue(over.events ?? 21) },
      booking: { count: jest.fn().mockResolvedValue(over.bookings ?? 174) },
    };
    const service = new OrgService(prisma as never, {} as never, {} as never);
    return { service, prisma };
  };

  it('counts a room booking as the private event it is', async () => {
    const { service } = build();
    const { stats } = await service.embedMembership('maybeitsfate');

    // 21 published events, 174 bookings that are not already one of them.
    expect(stats.allEvents).toBe(195);
  });

  it('leaves bookings out of the number a visitor can act on', async () => {
    const { service } = build();
    const { stats } = await service.embedMembership('maybeitsfate');

    // "Non-private" means what it says: a private event is not something to
    // advertise a visitor can come to.
    expect(stats.openEvents).toBe(21);
  });

  it('does not count a booking twice once it becomes an event', async () => {
    const { service, prisma } = build();
    await service.embedMembership('maybeitsfate');

    // The two are the same gathering, and the event is the half with a name.
    expect(prisma.booking.count.mock.calls[0][0].where.eventId).toBeNull();
  });

  it('falls back to what the co-op books itself when nothing was imported', async () => {
    // Same query, same question — a co-op with no calendars connected simply
    // has fewer bookings.
    const { service } = build({ bookings: 3 });
    const { stats } = await service.embedMembership('maybeitsfate');

    expect(stats.allEvents).toBe(24);
  });

  it('counts the whole month, not what is left of it', async () => {
    /*
      A window running from now to the month's end shrinks as the month goes
      on, so a co-op busy all May advertises one event on the 30th. What has
      already happened this month is still what happens here in a month.
    */
    const { service, prisma } = build();
    await service.embedMembership('maybeitsfate');

    const { startTime } = prisma.event.count.mock.calls[0][0].where;
    expect(startTime.gte.getUTCDate()).toBe(1);
    expect(startTime.gte.getTime()).toBeLessThan(Date.now());
  });
});
