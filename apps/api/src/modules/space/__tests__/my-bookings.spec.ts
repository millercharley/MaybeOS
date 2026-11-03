import { Test } from '@nestjs/testing';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Whose bookings these are (SPC-23).
 *
 * MaybeItsFate's calendar import produced 3,017 room reservations and filed
 * every one under c@maybeitsfate.com — the account the co-op's automation
 * keeps its Google calendar with, which also happens to be an organiser's.
 * Charley opened his member dashboard to the entire booking history of eight
 * rooms, presented as his own.
 *
 * A hold still has to hold the room, so it is not detached; it stops claiming
 * to be a person's.
 */

describe('a member’s own bookings', () => {
  let service: SpaceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { booking: { findMany: jest.fn().mockResolvedValue([]) } };

    const module = await Test.createTestingModule({
      providers: [SpaceService, { provide: PrismaService, useValue: prisma }],
    })
      .overrideProvider(SpaceService)
      .useFactory({ factory: (p: PrismaService) => new (SpaceService as any)(p), inject: [PrismaService] })
      .compile();

    service = module.get(SpaceService);
  });

  const where = () => prisma.booking.findMany.mock.calls[0][0].where;
  const order = () => prisma.booking.findMany.mock.calls[0][0].orderBy;

  it('never includes a hold the co-op made', async () => {
    await service.listUserBookings('u-1', 'org-1');

    expect(where().isCoopHold).toBe(false);
  });

  it('shows what is ahead by default', async () => {
    await service.listUserBookings('u-1', 'org-1');

    expect(where().endTime).toHaveProperty('gte');
    expect(order()).toEqual({ startTime: 'asc' });
  });

  it('measures from the end, so one in progress is not already past', async () => {
    // Dropping off the list at the moment it starts is the opposite of
    // useful: that is when somebody is most likely to be looking at it.
    await service.listUserBookings('u-1', 'org-1');

    expect(where().startTime).toBeUndefined();
    expect(where().endTime).toBeDefined();
  });

  it('shows the most recent first when looking back', async () => {
    await service.listUserBookings('u-1', 'org-1', 'past');

    expect(where().endTime).toHaveProperty('lt');
    expect(order()).toEqual({ startTime: 'desc' });
  });

  it('stays inside this co-op', async () => {
    await service.listUserBookings('u-1', 'org-1', 'past');

    expect(where().room).toEqual({ orgId: 'org-1' });
  });

  /** Reservations they were added to rather than made (SPC-37). */
  describe('whose reservations it shows', () => {
    it('shows their own', async () => {
      await service.listUserBookings('u-1', 'org-1');

      expect(where().OR).toContainEqual({ userId: 'u-1' });
    });

    it('also shows the ones they co-host, which is most of the point', async () => {
      // Two people run the evening and only one of them could see the room
      // was held.
      await service.listUserBookings('u-1', 'org-1');

      expect(where().OR).toContainEqual({ coHosts: { some: { userId: 'u-1' } } });
    });

    it('still leaves out the co-op’s own holds', async () => {
      // 3,017 of them, filed under one account (SPC-23). A hold blocks the
      // room without being anybody's booking, co-host or not.
      await service.listUserBookings('u-1', 'org-1');

      expect(where().isCoopHold).toBe(false);
    });
  });
});
