import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * Copying an event to a new date (EVT-38).
 *
 * Charley: "add clone as its own button. Offer a double opt-in for cloning
 * events or room reservations that are recurring."
 *
 * The second half is the interesting one. A member looking at one Tuesday of
 * a weekly class cannot tell from the screen whether "clone" means that
 * Tuesday or all fifty-two, and guessing either way is wrong half the time.
 */

const base = {
  id: 'e-1',
  orgId: 'org-1',
  parentEventId: null as string | null,
  slug: 'open-studio',
  title: 'Open Studio',
  description: null,
  startTime: new Date('2026-10-06T23:00:00Z'),
  endTime: new Date('2026-10-07T01:00:00Z'),
  timezone: 'America/Kentucky/Louisville',
  visibility: 'MEMBERS_ONLY',
  category: null,
  tags: [],
  capacity: null,
  waitlistEnabled: false,
  hostId: 'u-host',
  hasCost: false,
  suggestedCents: null,
  priceCents: null,
  currency: 'usd',
  maturityLevel: 'ALL_AGES',
  locationId: null,
  roomId: null,
  imageUrl: null,
  imageCredit: null,
  imageCreditUrl: null,
  coHosts: [],
  rooms: [
    {
      id: 'b-1',
      roomId: 'room-attic',
      startTime: new Date('2026-10-06T23:00:00Z'),
      endTime: new Date('2026-10-07T01:00:00Z'),
    },
  ],
};

/** The same event, a week later, as a child of the first. */
const weekLater = {
  ...base,
  id: 'e-2',
  parentEventId: 'e-1',
  startTime: new Date('2026-10-13T23:00:00Z'),
  endTime: new Date('2026-10-14T01:00:00Z'),
};

describe('cloning', () => {
  let service: EventsService;
  let prisma: any;

  const setup = (series: unknown[]) => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ timezone: base.timezone }) },
      event: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'e-1', orgId: 'org-1', hostId: 'u-host' })
          .mockResolvedValue(base),
        findMany: jest.fn().mockResolvedValue(series),
        create: jest.fn().mockImplementation(() => Promise.resolve({ id: `new-${Math.random()}` })),
      },
      eventCoHost: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
    return prisma;
  };

  const build = async () => {
    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    })
      .compile()
      .catch(() => null);

    service = module ? module.get(EventsService) : (new (EventsService as any)(prisma) as EventsService);
  };

  const actor = { userId: 'u-host', isStaff: true };
  const nextYear = '2027-02-14T19:00:00.000Z';

  describe('a one-off', () => {
    beforeEach(async () => {
      setup([base]);
      await build();
    });

    it('needs no scope, because there is nothing to confuse', async () => {
      const plan: any = await service.clone('org-1', 'e-1', { startTime: nextYear }, actor);

      expect(plan.copies).toBe(1);
      expect(plan.hasSeries).toBe(false);
    });

    it('makes one copy, as a draft', async () => {
      await service.clone('org-1', 'e-1', { startTime: nextYear, dryRun: false }, actor);

      expect(prisma.event.create).toHaveBeenCalledTimes(1);
      expect(prisma.event.create.mock.calls[0][0].data.isPublished).toBe(false);
    });

    it('holds the room for the copy', async () => {
      await service.clone('org-1', 'e-1', { startTime: nextYear, dryRun: false }, actor);

      expect(prisma.booking.create).toHaveBeenCalledTimes(1);
    });

    it('leaves the room alone where it is already taken', async () => {
      prisma.booking.findFirst.mockResolvedValue({ id: 'someone-else' });

      await service.clone('org-1', 'e-1', { startTime: nextYear, dryRun: false }, actor);

      expect(prisma.event.create).toHaveBeenCalledTimes(1);
      expect(prisma.booking.create).not.toHaveBeenCalled();
    });
  });

  describe('one of a series', () => {
    beforeEach(async () => {
      setup([base, weekLater]);
      await build();
    });

    it('refuses to guess what was meant', async () => {
      // The first half of the opt-in.
      await expect(
        service.clone('org-1', 'e-1', { startTime: nextYear }, actor),
      ).rejects.toThrow(/copy just this one or all 2/);
    });

    it('copies one when that is what was asked', async () => {
      const plan: any = await service.clone(
        'org-1',
        'e-1',
        { startTime: nextYear, scope: 'one' },
        actor,
      );

      expect(plan.copies).toBe(1);
      expect(plan.hasSeries).toBe(true);
    });

    it('does not make somebody confirm copying one', async () => {
      // It is undone by deleting a single draft. Asking twice about that
      // teaches people to click through the question that matters.
      await expect(
        service.clone('org-1', 'e-1', { startTime: nextYear, scope: 'one', dryRun: false }, actor),
      ).resolves.toBeDefined();
    });

    it('makes somebody confirm copying the whole series', async () => {
      // The second half of the opt-in: the choice that writes dozens of rows.
      await expect(
        service.clone('org-1', 'e-1', { startTime: nextYear, scope: 'series' }, actor),
      ).rejects.toThrow(/Confirm that is what you want/);
    });

    it('copies the series once confirmed, keeping the spacing', async () => {
      await service.clone(
        'org-1',
        'e-1',
        { startTime: nextYear, scope: 'series', confirmSeries: true, dryRun: false },
        actor,
      );

      const starts = prisma.event.create.mock.calls.map((c: any) => c[0].data.startTime.getTime());
      expect(starts).toHaveLength(2);
      expect(starts[1] - starts[0]).toBe(7 * 86_400_000);
    });

    it('makes the copy its own series, not more children of the original', async () => {
      await service.clone(
        'org-1',
        'e-1',
        { startTime: nextYear, scope: 'series', confirmSeries: true, dryRun: false },
        actor,
      );

      const [first, second] = prisma.event.create.mock.calls.map((c: any) => c[0].data);
      expect(first.parentEventId).toBeNull();
      expect(second.parentEventId).toBeTruthy();
      expect(second.parentEventId).not.toBe('e-1');
    });
  });

  describe('the year a clone may reach', () => {
    it('drops copies that would land more than a year out', async () => {
      // A year of a weekly series cloned to a new start is another year, not
      // two (EVT-38).
      const long = Array.from({ length: 60 }, (_, i) => ({
        ...base,
        id: `e-${i}`,
        parentEventId: i === 0 ? null : 'e-0',
        startTime: new Date(base.startTime.getTime() + i * 7 * 86_400_000),
        endTime: new Date(base.endTime.getTime() + i * 7 * 86_400_000),
      }));
      setup(long);
      await build();

      const plan: any = await service.clone(
        'org-1',
        'e-1',
        { startTime: nextYear, scope: 'series', confirmSeries: true },
        actor,
      );

      expect(plan.copies).toBeLessThanOrEqual(53);
      expect(plan.droppedPastAYear).toBeGreaterThan(0);
    });
  });
});
