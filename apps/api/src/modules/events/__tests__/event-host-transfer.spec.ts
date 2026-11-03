import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { EventsService } from '../events.service';
import { RadarService } from '../../radar/radar.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';
import { EmailService } from '../../email/email.service';

/**
 * Handing a batch of events to a new host (EVT-47).
 *
 * Charley: "As an admin, I want to transfer events to a new owner. From the
 * calendar migration, I have a lot of events in MaybeItsFate that are still
 * owned by me (c@maybeitsfate.com) that I want to remove from My Events and
 * make sure the real member who manages the event see all of this recurring
 * event listed under their My Events to manage."
 *
 * 769 of them, because the calendar import creates what it finds under the
 * account whose calendar it read.
 */
describe('EventsService — transferring events to a new host', () => {
  let service: EventsService;
  let prisma: Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };

  const ORG = 'org-1';
  const FROM = 'charley';
  const TO = 'the-member';
  const ADMIN = 'an-organiser';

  const event = (over: Record<string, unknown> = {}) => ({
    id: 'evt-1',
    title: 'Board Games Club',
    hostId: FROM,
    startTime: new Date('2026-11-10T19:00:00Z'),
    endTime: new Date('2026-11-10T22:00:00Z'),
    payout: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      event: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      eventCoHost: { deleteMany: jest.fn() },
      userOrg: { findUnique: jest.fn().mockResolvedValue({ userId: TO }) },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    } as never;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConnectService,
          useValue: {
            refundEventTickets: jest
              .fn()
              .mockResolvedValue({ attempted: 0, refunded: 0, failed: [] }),
          },
        },
        { provide: EmailService, useValue: { sendWaitlistPromoted: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: RadarService, useValue: { recordRsvp: jest.fn() } },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  const transfer = (over: Record<string, unknown> = {}) =>
    service.transferHost(
      ORG, { fromUserId: FROM, toUserId: TO, eventIds: ['evt-1'], ...over } as never, ADMIN,
    );

  describe('who it may be handed to', () => {
    it('refuses somebody outside the co-op', async () => {
      prisma.userOrg.findUnique.mockResolvedValue(null);

      await expect(transfer()).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses handing somebody their own events', async () => {
      await expect(transfer({ toUserId: FROM })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('checks the roster before reading a single event', async () => {
      prisma.userOrg.findUnique.mockResolvedValue(null);

      await expect(transfer()).rejects.toThrow();
      expect(prisma.event.findMany).not.toHaveBeenCalled();
    });
  });

  describe('which events it will touch', () => {
    it('looks them up by org and by the host they were said to belong to', async () => {
      await transfer({ eventIds: ['evt-1', 'evt-2'] });

      // Both halves matter. The org is the tenant boundary (D-009, SEC-04);
      // the host is what stops a stale list moving an event that was never
      // the one on screen.
      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['evt-1', 'evt-2'] }, orgId: ORG, hostId: FROM },
        }),
      );
    });

    it('reports an id it could not claim rather than silently dropping it', async () => {
      prisma.event.findMany.mockResolvedValue([event({ id: 'evt-1' })]);

      const result = await transfer({ eventIds: ['evt-1', 'gone'] });

      expect(result.moved).toBe(1);
      expect(result.refused).toEqual([
        { id: 'gone', reason: expect.stringMatching(/not one of theirs|not in this co-op/) },
      ]);
    });

    it('does not move an event whose ticket money has been counted', async () => {
      prisma.event.findMany.mockResolvedValue([
        event({ id: 'evt-1' }),
        event({ id: 'evt-2', payout: { hostUserId: FROM } }),
      ]);

      const result = await transfer({ eventIds: ['evt-1', 'evt-2'] });

      expect(result.movedIds).toEqual(['evt-1']);
      expect(result.refused).toEqual([
        { id: 'evt-2', reason: expect.stringMatching(/Ticket money/) },
      ]);
    });

    it('asks for each id once, however many times it was sent', async () => {
      await transfer({ eventIds: ['evt-1', 'evt-1'] });

      expect(prisma.event.findMany.mock.calls[0][0].where.id.in).toEqual(['evt-1']);
    });
  });

  describe('what the write does', () => {
    beforeEach(() => {
      prisma.event.findMany.mockResolvedValue([event()]);
    });

    it('sets the new host', async () => {
      await transfer();

      expect(prisma.event.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['evt-1'] } },
          data: expect.objectContaining({ hostId: TO }),
        }),
      );
    });

    it('clears the imported organiser, which naming a real member supersedes', async () => {
      // CAL-03 carries a Google organiser's name onto an imported event so a
      // member who rejoins finds the evenings they ran. Once a real member is
      // named, the stand-in is wrong.
      await transfer();

      expect(prisma.event.updateMany.mock.calls[0][0].data).toMatchObject({
        hostEmail: null,
        hostName: null,
      });
    });

    it('takes the new host off the co-host list of their own event', async () => {
      // Otherwise the event reads "hosted by Ada, with Ada" — the same rule
      // `setHost` applies one event at a time.
      await transfer();

      expect(prisma.eventCoHost.deleteMany).toHaveBeenCalledWith({
        where: { eventId: { in: ['evt-1'] }, userId: TO },
      });
    });

    it('does both in one transaction, so neither lands without the other', async () => {
      await transfer();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('records who moved what', async () => {
      await transfer();

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId: ORG,
          actorId: ADMIN,
          action: 'event.host_transferred',
          metadata: expect.objectContaining({
            fromUserId: FROM,
            toUserId: TO,
            count: 1,
            eventIds: ['evt-1'],
          }),
        }),
      });
    });

    it('writes nothing at all when nothing survived the rules', async () => {
      prisma.event.findMany.mockResolvedValue([event({ payout: { hostUserId: FROM } })]);

      const result = await transfer();

      expect(result.moved).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      // No audit row either: nothing happened, and a log saying otherwise is
      // worse than no log.
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('dryRun, like every other bulk action here', () => {
    it('reports what would move and writes nothing', async () => {
      prisma.event.findMany.mockResolvedValue([
        event({ id: 'evt-1' }),
        event({ id: 'evt-2', payout: { hostUserId: FROM } }),
      ]);

      const result = await transfer({ eventIds: ['evt-1', 'evt-2'], dryRun: true });

      expect(result).toMatchObject({ dryRun: true, moved: 1, movedIds: ['evt-1'] });
      expect(result.refused).toHaveLength(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.event.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('answers from the same rule the write uses', async () => {
      // A preview that promised something the write then refused would be
      // worse than no preview.
      prisma.event.findMany.mockResolvedValue([
        event({ id: 'evt-1' }),
        event({ id: 'evt-2', payout: { hostUserId: FROM } }),
      ]);

      const preview = await transfer({ eventIds: ['evt-1', 'evt-2'], dryRun: true });
      const real = await transfer({ eventIds: ['evt-1', 'evt-2'] });

      expect(preview.movedIds).toEqual(real.movedIds);
      expect(preview.refused).toEqual(real.refused);
    });
  });

  /**
   * Starting a new event from one they already ran (EVT-48).
   *
   * Lives in this file because it shares the harness, not the feature: both
   * read one person's events out of `event.findMany`.
   */
  describe('events a member can reuse', () => {
    const reusable = (q?: string) => service.listReusableEvents(ORG, FROM, q);
    const query = () => prisma.event.findMany.mock.calls[0][0];

    it('finds the ones they host and the ones they co-host', () => {
      // The same pair My Events uses: somebody who helped run a workshop
      // knows what the description said.
      return reusable().then(() => {
        expect(query().where.OR).toEqual([
          { hostId: FROM },
          { coHosts: { some: { userId: FROM } } },
        ]);
      });
    });

    it('stays inside this co-op', async () => {
      await reusable();

      expect(query().where.orgId).toBe(ORG);
    });

    it('searches the title, and only when there is something to search for', async () => {
      await reusable('  board  ');

      expect(query().where.title).toEqual({ contains: 'board', mode: 'insensitive' });
    });

    it('asks for no filter when the box is empty', async () => {
      await reusable('   ');

      expect(query().where.title).toBeUndefined();
    });

    it('takes the newest first, since one per title keeps the most recent', async () => {
      await reusable();

      expect(query().orderBy).toEqual({ startTime: 'desc' });
    });

    it('collapses the dates of one event into a single option', async () => {
      // 46 Board Games Clubs are one thing the co-op runs.
      prisma.event.findMany.mockResolvedValue([
        { id: 'a', title: 'Board Games Club', startTime: new Date('2028-10-29T19:00:00Z') },
        { id: 'b', title: 'Board Games Club', startTime: new Date('2025-01-27T19:00:00Z') },
        { id: 'c', title: 'Improv Club', startTime: new Date('2027-05-07T19:00:00Z') },
      ]);

      const list = await reusable();

      expect(list.map((e) => e.id)).toEqual(['a', 'c']);
    });

    it('asks for a window rather than the whole history', async () => {
      // Charley hosts 767. The collapse happens here, so a `take` smaller
      // than the window would return twenty rows of one evening.
      await reusable();

      expect(query().take).toBe(400);
    });

    it('never selects an address', async () => {
      // Co-hosts travel as names so the form can show them. The rule the
      // room calendar and the member card both follow.
      await reusable();

      expect(JSON.stringify(query().select)).not.toMatch(/email/);
    });

    it('does not offer when it was or where it was', async () => {
      // `startTime` is selected to show when it last ran, and `endTime`,
      // `roomId` and `locationId` are not selected at all — they are the two
      // answers that are never the same twice.
      await reusable();

      expect(query().select.endTime).toBeUndefined();
      expect(query().select.roomId).toBeUndefined();
      expect(query().select.locationId).toBeUndefined();
      expect(query().select.hostId).toBeUndefined();
    });
  });

  describe('what an admin is shown before deciding', () => {
    it('groups one person’s events by what the co-op calls them', async () => {
      prisma.event.findMany.mockResolvedValue([
        event({ id: 'a', title: 'Board Games Club' }),
        event({ id: 'b', title: 'Board Games Club' }),
        event({ id: 'c', title: 'Improv Club' }),
      ]);

      const { total, groups } = await service.listOwnedEvents(ORG, FROM);

      expect(total).toBe(3);
      expect(groups).toHaveLength(2);
      expect(groups[0]).toMatchObject({ title: 'Board Games Club', total: 2 });
    });

    it('scopes the list to the co-op in the URL', async () => {
      await service.listOwnedEvents(ORG, FROM);

      expect(prisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orgId: ORG, hostId: FROM } }),
      );
    });

    it('includes drafts and past dates, which is what the member is owed', async () => {
      // "see all of this recurring event listed under their My Events" —
      // handing over this autumn and keeping 2025 gives them half a series.
      await service.listOwnedEvents(ORG, FROM);

      const where = prisma.event.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('isPublished');
      expect(where).not.toHaveProperty('endTime');
      expect(where).not.toHaveProperty('startTime');
    });

    it('reads the payout, so a refusal is visible before anything is sent', async () => {
      await service.listOwnedEvents(ORG, FROM);

      expect(prisma.event.findMany.mock.calls[0][0].select.payout).toBeTruthy();
    });
  });
});
