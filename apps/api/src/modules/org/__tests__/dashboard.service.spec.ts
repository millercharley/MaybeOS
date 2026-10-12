import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../config/prisma.service';
import { DashboardService } from '../dashboard.service';

/**
 * The two questions a screen answers the moment it opens.
 *
 * What is worth pinning here is not the shape of the payload — it is the
 * windows. A "happening now" strip that quietly means "happening today" is
 * worse than no strip, because somebody reads it standing in an empty room.
 */
describe('DashboardService', () => {
  const NOW = new Date('2026-08-28T14:00:00Z');
  let prisma: any;
  let service: DashboardService;

  beforeEach(async () => {
    prisma = {
      userOrg: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      event: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      // Who the viewer has already written to (DSH-04). Nobody, by default.
      messageThread: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module = await Test.createTestingModule({
      providers: [DashboardService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(DashboardService);
  });

  describe('membership', () => {
    it('counts members, and guests are not members', async () => {
      await service.memberStats('org1', NOW);
      for (const call of prisma.userOrg.count.mock.calls) {
        expect(call[0].where.role.in).toEqual(['ADMIN', 'STAFF', 'MEMBER']);
      }
    });

    it('counts joins from the first of the month, in UTC', async () => {
      await service.memberStats('org1', NOW);
      const [, joined] = prisma.userOrg.count.mock.calls;
      expect(joined[0].where.memberSince.gte).toEqual(new Date('2026-08-01T00:00:00Z'));
    });

    it('returns joins rather than a net figure', async () => {
      // Removing a membership deletes the row, so there is no record of
      // departures and no honest way to compute net growth. The field is
      // named for what it is.
      prisma.userOrg.count.mockResolvedValueOnce(464).mockResolvedValueOnce(2);
      const stats = await service.memberStats('org1', NOW);
      expect(stats).toMatchObject({ total: 464, joinedThisMonth: 2 });
      expect(stats).not.toHaveProperty('netChange');
    });
  });

  describe('the welcome card', () => {
    const joiner = (n: number) => ({
      id: `m${n}`,
      memberSince: NOW,
      headline: null,
      user: { id: `u${n}`, name: `Member ${n}`, avatarPath: null },
    });

    it('never welcomes you to your own arrival', async () => {
      // The "say hi" button would open a conversation with yourself.
      await service.recentJoins('org1', 'me', NOW);
      expect(prisma.userOrg.findMany.mock.calls[0][0].where.userId).toEqual({ not: 'me' });
    });

    it('looks back a week, not forever', async () => {
      await service.recentJoins('org1', 'me', NOW);
      expect(prisma.userOrg.findMany.mock.calls[0][0].where.memberSince.gte).toEqual(
        new Date('2026-08-21T14:00:00Z'),
      );
    });

    it('shows three and counts the rest', async () => {
      // A co-op that imported four hundred members must not get four hundred
      // welcome cards, and even a real week of arrivals reads better as
      // "and one other" than as a wall.
      prisma.userOrg.findMany.mockResolvedValue([1, 2, 3, 4].map(joiner));

      const result = await service.recentJoins('org1', 'me', NOW);
      expect(result.members).toHaveLength(3);
      expect(result.more).toBe(1);
    });

    /**
     * Hiding the prompt once it has been acted on (DSH-04).
     *
     * Charley: "I've sent messages to Jalynn, Harold, and Diego. I would
     * like the system to know that and then hide these Say Hi prompts." A
     * card asking you to do something you have already done is a card you
     * learn to ignore, and the next one goes unread with it.
     */
    describe('somebody already written to', () => {
      /** The thread between the viewer and user `n`, as the key sorts it. */
      const keyFor = (n: number) => ['me', `u${n}`].sort().join(',');

      it('drops off the card', async () => {
        prisma.userOrg.findMany.mockResolvedValue([1, 2, 3, 4].map(joiner));
        prisma.messageThread.findMany.mockResolvedValue([
          { participantKey: keyFor(1) },
          { participantKey: keyFor(2) },
        ]);

        const result = await service.recentJoins('org1', 'me', NOW);

        expect(result.members.map((m) => m.userId)).toEqual(['u3', 'u4']);
        expect(result.more).toBe(0);
      });

      it('is read from a message sent, not a conversation opened', async () => {
        // Following "say hi" and typing nothing is not saying hi.
        await service.recentJoins('org1', 'me', NOW);
        prisma.userOrg.findMany.mockResolvedValue([joiner(1)]);
        await service.recentJoins('org1', 'me', NOW);

        const { where } = prisma.messageThread.findMany.mock.calls[0][0];
        expect(where.messages).toEqual({ some: { senderId: 'me' } });
      });

      it('does not count being in a group with them', async () => {
        /*
          `participantKey` is every participant's id sorted and joined, so
          asking for exactly the pair's key finds the one-to-one thread and
          never a group that happens to contain them both.
        */
        prisma.userOrg.findMany.mockResolvedValue([joiner(1)]);
        await service.recentJoins('org1', 'me', NOW);

        const { where } = prisma.messageThread.findMany.mock.calls[0][0];
        expect(where.participantKey).toEqual({ in: [keyFor(1)] });
      });

      it('stays inside this co-op', async () => {
        // Two people who share two co-ops hold two conversations (CMN-08).
        prisma.userOrg.findMany.mockResolvedValue([joiner(1)]);
        await service.recentJoins('org1', 'me', NOW);

        expect(prisma.messageThread.findMany.mock.calls[0][0].where.orgId).toBe('org1');
      });

      it('asks nothing when nobody has joined', async () => {
        await service.recentJoins('org1', 'me', NOW);
        expect(prisma.messageThread.findMany).not.toHaveBeenCalled();
      });

      it('reads more than it shows, because some will be filtered out', async () => {
        /*
          The mocks return whatever they are told regardless of `take`, so
          the filling test below cannot see this — and a `take` of four, the
          number before DSH-04, would quietly show two people when five were
          waiting. Asserted against the query itself.
        */
        await service.recentJoins('org1', 'me', NOW);

        const { take } = prisma.userOrg.findMany.mock.calls[0][0];
        expect(take).toBeGreaterThan(4);
      });

      it('still fills the card from further down the week', async () => {
        // Filtering after taking only four would have shown two people when
        // five were waiting. It takes more and then filters.
        prisma.userOrg.findMany.mockResolvedValue([1, 2, 3, 4, 5, 6].map(joiner));
        prisma.messageThread.findMany.mockResolvedValue([
          { participantKey: keyFor(1) },
          { participantKey: keyFor(2) },
        ]);

        const result = await service.recentJoins('org1', 'me', NOW);

        expect(result.members.map((m) => m.userId)).toEqual(['u3', 'u4', 'u5']);
        expect(result.more).toBe(1);
      });

      it('shows the card to nobody once everyone has been greeted', async () => {
        prisma.userOrg.findMany.mockResolvedValue([joiner(1)]);
        prisma.messageThread.findMany.mockResolvedValue([{ participantKey: keyFor(1) }]);

        const result = await service.recentJoins('org1', 'me', NOW);

        expect(result.members).toEqual([]);
        expect(result.more).toBe(0);
      });
    });

    it('says nothing when nobody has joined', async () => {
      const result = await service.recentJoins('org1', 'me', NOW);
      expect(result.members).toEqual([]);
      expect(result.more).toBe(0);
    });

    it('stores nothing — the card is derived, not posted', async () => {
      // A real Post would sit in the channel forever, push conversation
      // down, and need a moderation decision to remove.
      await service.recentJoins('org1', 'me', NOW);
      expect(Object.keys(prisma)).not.toContain('post');
    });
  });

  describe('happening now means now', () => {
    it('asks for events under way, not events today', async () => {
      // "Checked in today" still shows the morning's crowd at 9pm, to
      // somebody standing in an empty room.
      await service.happeningNow('org1', NOW);
      const live = prisma.event.findMany.mock.calls[0][0].where;
      expect(live.startTime.lte).toEqual(NOW);
      expect(live.endTime.gte).toEqual(NOW);
    });

    it('only counts people who actually checked in', async () => {
      await service.happeningNow('org1', NOW);
      const rsvps = prisma.event.findMany.mock.calls[0][0].select.rsvps.where;
      expect(rsvps.checkedIn).toBe(true);
      // Guest RSVPs have no user and no face to show.
      expect(rsvps.userId).toEqual({ not: null });
    });

    it('treats only approved bookings as a room in use', async () => {
      // PENDING is still waiting on an organiser. Showing it would tell a
      // member a room is busy when it is merely requested.
      await service.happeningNow('org1', NOW);
      expect(prisma.booking.findMany.mock.calls[0][0].where.status).toBe('APPROVED');
    });

    it('looks exactly two hours ahead for what starts soon', async () => {
      await service.happeningNow('org1', NOW);
      const soon = prisma.event.findMany.mock.calls[1][0].where;
      expect(soon.startTime.gt).toEqual(NOW);
      expect(soon.startTime.lte).toEqual(new Date('2026-08-28T16:00:00Z'));
      // An unpublished event is not something to tell a member about.
      expect(soon.isPublished).toBe(true);
    });

    it('reports the count separately from the faces it shows', async () => {
      // The list is capped, and a room of forty must not read as a room of
      // twelve.
      prisma.event.findMany.mockResolvedValueOnce([
        {
          id: 'e1',
          title: 'Supper',
          endTime: NOW,
          rsvps: Array.from({ length: 12 }, (_, i) => ({
            checkedInAt: NOW,
            user: { id: `u${i}`, name: `M${i}`, avatarPath: null },
          })),
        },
      ]);

      const result = await service.happeningNow('org1', NOW);
      expect(result.checkedInCount).toBe(12);
      expect(result.checkedIn).toHaveLength(12);
    });

    it('stamps when it was true, so nothing claims to be live', async () => {
      const result = await service.happeningNow('org1', NOW);
      expect(result.asOf).toEqual(NOW);
    });

    it('prefers the room over the building for somebody already inside', async () => {
      prisma.event.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'e2',
          title: 'Circle',
          slug: 'circle',
          startTime: NOW,
          location: { name: 'The Old Bakery' },
          room: { name: 'Back Room' },
          _count: { rsvps: 4 },
        },
      ]);

      const result = await service.happeningNow('org1', NOW);
      expect(result.startingSoon[0].where).toBe('Back Room');
    });
  });
});
