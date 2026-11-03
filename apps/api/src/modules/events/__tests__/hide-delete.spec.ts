import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';

/**
 * Hiding and deleting an event (EVT-30, EVT-50).
 *
 * Charley, after importing 777 events: "Make sure as an admin, I have the
 * ability to hide or delete any events (I see duplicate events that were
 * duplicated in my google calendar)."
 *
 * And then, once that was in use: "Allow for the deletion (or hiding if that's
 * safer) by the admin or owner of future events that have an RSVP. This is not
 * the same for sold tickets to future events: those can't be deleted or hidden
 * until all tickets have been refunded."
 *
 * Both halves of the second ask move a rule, in opposite directions. An RSVP
 * stopped a delete and now stops nothing — which is what makes the duplicate
 * case fixable, since the moment one member RSVPs to the wrong copy the wrong
 * copy was permanent. A sold ticket stopped a delete and now stops hiding
 * too, which it never did.
 */

describe('hiding and deleting', () => {
  let service: EventsService;
  let prisma: any;

  const OWNER = 'the-host';
  const owner = { userId: OWNER, isStaff: false };
  const organiser = { userId: 'an-admin', isStaff: true };

  const found = (counts: { tickets?: number; refunded?: number } = {}) => ({
    id: 'e-1',
    isPublished: true,
    hostId: OWNER,
    createdById: OWNER,
    /*
      Only the unrefunded ones, because that is what the query asks for:
      `where: { refundedAt: null }`. Each row carries a seat count (EVT-47),
      and the refusal counts seats, so these are one seat each the way every
      real row was until the quantity selector shipped.
    */
    tickets: Array.from({ length: counts.tickets ?? 0 }, () => ({ quantity: 1 })),
  });

  const snapshot = (over: Record<string, unknown> = {}) => ({
    title: 'Improv Club',
    slug: 'improv-club',
    startTime: new Date('2026-11-06T23:00:00Z'),
    endTime: new Date('2026-11-07T00:30:00Z'),
    visibility: 'PUBLIC',
    isPublished: true,
    hostId: OWNER,
    createdById: OWNER,
    googleEventId: 'g-1',
    bookingId: null,
    hostEmail: null,
    _count: { rsvps: 6, tickets: 0, attendance: 0 },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      event: {
        /*
          Two reads, told apart by what they ask for: the rule's read wants
          the unrefunded tickets, and the delete's snapshot wants the counts
          it is about to lose (EVT-51). Both go through `findFirst`, because
          both resolve the event through its org (SEC-04).
        */
        findFirst: jest.fn(async (args: any) =>
          args?.select?._count ? snapshot() : found(),
        ),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    })
      .compile()
      .catch(async () => null as never);

    service = module
      ? module.get(EventsService)
      : (new (EventsService as any)(prisma) as EventsService);
  });

  describe('hiding', () => {
    it('takes it off the members’ lists', async () => {
      await service.unpublish('org-1', 'e-1', organiser);

      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'e-1' },
        data: { isPublished: false },
      });
    });

    it('destroys nothing', async () => {
      await service.unpublish('org-1', 'e-1', organiser);

      expect(prisma.event.delete).not.toHaveBeenCalled();
    });

    it('refuses an event in another co-op', async () => {
      prisma.event.findFirst.mockResolvedValue(null);

      await expect(service.unpublish('org-1', 'e-1', organiser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses while somebody is out of pocket, which it never used to', async () => {
      /*
        Hiding checked nothing at all, so an event somebody had paid for could
        be taken off the members' list with their money still in the co-op's
        account and the page they would look at it on simply gone.
      */
      prisma.event.findFirst.mockResolvedValue(found({ tickets: 2 }));

      await expect(service.unpublish('org-1', 'e-1', organiser)).rejects.toThrow(
        /cannot be hidden/,
      );
      expect(prisma.event.update).not.toHaveBeenCalled();
    });
  });

  describe('deleting', () => {
    it('deletes a clean one', async () => {
      const result = await service.deleteEvent('org-1', 'e-1', organiser);

      expect(prisma.event.delete).toHaveBeenCalledWith({ where: { id: 'e-1' } });
      expect(result).toEqual({ deleted: true });
    });

    it('deletes one a member has in their diary', async () => {
      /*
        The change. The commonest thing an organiser needs to delete is a
        duplicate the import brought across twice, and cancelling it instead
        leaves a cancelled event on the calendar announcing that an evening
        was called off which is in fact happening, in the other row.
      */
      await service.deleteEvent('org-1', 'e-1', organiser);

      expect(prisma.event.delete).toHaveBeenCalled();
    });

    it('does not even ask how many RSVPs there are', async () => {
      // It used to count them. A rule nothing reads is a rule that will be
      // re-added by accident.
      await service.deleteEvent('org-1', 'e-1', organiser);

      expect(JSON.stringify(prisma.event.findFirst.mock.calls[0][0])).not.toMatch(/rsvp/i);
    });

    it('refuses one somebody paid for', async () => {
      prisma.event.findFirst.mockResolvedValue(found({ tickets: 2 }));

      await expect(service.deleteEvent('org-1', 'e-1', organiser)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.event.delete).not.toHaveBeenCalled();
    });

    it('says how many, and what to do about it', async () => {
      // "Cannot delete" with no number is a dead end, and the next step is a
      // refund rather than a cancel.
      prisma.event.findFirst.mockResolvedValue(found({ tickets: 1 }));

      await expect(service.deleteEvent('org-1', 'e-1', organiser)).rejects.toThrow(
        /1 ticket has been sold[\s\S]*not refunded[\s\S]*Cancel it to refund everybody/,
      );
    });

    it('counts only the tickets still owed money', async () => {
      /*
        The query asks for `refundedAt: null`, so an event cancelled and
        fully refunded has none — it used to count every ticket row ever
        written, and the refusal outlived the reason for it.
      */
      await service.deleteEvent('org-1', 'e-1', organiser);

      expect(prisma.event.findFirst.mock.calls[0][0].select.tickets.where).toEqual({
        refundedAt: null,
      });
    });
  });

  describe('who may do either', () => {
    it('lets an organiser', async () => {
      await service.deleteEvent('org-1', 'e-1', organiser);

      expect(prisma.event.delete).toHaveBeenCalled();
    });

    it('lets the owner delete their own', async () => {
      // "by the admin or owner". A member clearing up after themselves.
      await service.deleteEvent('org-1', 'e-1', owner);

      expect(prisma.event.delete).toHaveBeenCalled();
    });

    it('lets the owner hide their own', async () => {
      await service.unpublish('org-1', 'e-1', owner);

      expect(prisma.event.update).toHaveBeenCalled();
    });

    it('refuses a member who neither hosts nor made it', async () => {
      const stranger = { userId: 'somebody-else', isStaff: false };

      await expect(service.deleteEvent('org-1', 'e-1', stranger)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.event.delete).not.toHaveBeenCalled();
    });

    it('refuses a co-host, who may edit everything but not destroy it', async () => {
      // Being asked to help run an evening is not being handed the power to
      // make it never have existed.
      prisma.event.findFirst.mockResolvedValue({
        ...found(),
        hostId: 'somebody-else',
        createdById: 'somebody-else',
      });

      await expect(
        service.unpublish('org-1', 'e-1', { userId: 'a-co-host', isStaff: false }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('checks who is asking before it checks the tickets', async () => {
      // A stranger must not learn how many tickets an event sold by being
      // told why they cannot delete it.
      prisma.event.findFirst.mockResolvedValue(found({ tickets: 3 }));

      await expect(
        service.deleteEvent('org-1', 'e-1', { userId: 'somebody-else', isStaff: false }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

describe('what the routes require', () => {
  const controller = readFileSync(join(__dirname, '..', 'events.controller.ts'), 'utf8');
  const route = (marker: string) =>
    controller.slice(controller.indexOf(marker), controller.indexOf(marker) + 700);

  it('does not gate hiding on a role, because the answer is not a role', () => {
    expect(route("@Post('orgs/:orgId/events/:eventId/unpublish')")).not.toMatch(/@Roles\(/);
  });

  it('does not gate deleting on a role either', () => {
    // It was ADMIN only. "the admin or owner" is not expressible as a role,
    // so the guard moved into the service.
    expect(route("@Delete('orgs/:orgId/events/:eventId')")).not.toMatch(/@Roles\(/);
  });

  it('passes the caller to both, so the service can decide', () => {
    expect(route("@Post('orgs/:orgId/events/:eventId/unpublish')")).toMatch(/@CurrentUser\(\)/);
    expect(route("@Delete('orgs/:orgId/events/:eventId')")).toMatch(/@CurrentUser\(\)/);
  });
});

/**
 * What is left behind when an event is destroyed (EVT-51).
 *
 * An event vanished mid-session and there was nothing anywhere to say so.
 * Transfers could be replayed from their audit rows; the one action that
 * genuinely cannot be undone logged nothing at all. It matters more now that
 * deleting is open to any host rather than an admin alone, and no longer
 * refuses on an RSVP.
 */
describe('the record a delete leaves', () => {
  let service: EventsService;
  let prisma: any;

  const organiser = { userId: 'an-admin', isStaff: true };

  const snapshot = (over: Record<string, unknown> = {}) => ({
    title: 'Improv Club',
    slug: 'improv-club',
    startTime: new Date('2026-11-06T23:00:00Z'),
    endTime: new Date('2026-11-07T00:30:00Z'),
    visibility: 'PUBLIC',
    isPublished: true,
    hostId: 'the-host',
    createdById: 'the-host',
    googleEventId: 'g-1',
    bookingId: 'b-1',
    hostEmail: null,
    _count: { rsvps: 6, tickets: 0, attendance: 0 },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      event: {
        findFirst: jest.fn(async (args: any) =>
          args?.select?._count
            ? snapshot()
            : {
                id: 'e-1',
                isPublished: true,
                hostId: 'the-host',
                createdById: 'the-host',
                tickets: [],
              },
        ),
        delete: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    service = new (EventsService as any)(prisma) as EventsService;
  });

  const written = () => prisma.auditLog.create.mock.calls[0][0].data;

  it('writes one, naming who did it', async () => {
    await service.deleteEvent('org-1', 'e-1', organiser);

    expect(written()).toMatchObject({
      orgId: 'org-1',
      actorId: 'an-admin',
      action: 'event.deleted',
      entityType: 'Event',
      entityId: 'e-1',
    });
  });

  it('keeps what the event was, since the row will not be there to ask', async () => {
    await service.deleteEvent('org-1', 'e-1', organiser);

    expect(written().metadata).toMatchObject({
      title: 'Improv Club',
      startTime: '2026-11-06T23:00:00.000Z',
      visibility: 'PUBLIC',
      wasPublished: true,
      hostId: 'the-host',
    });
  });

  it('counts who loses it, which is the warning nothing else gives now', async () => {
    await service.deleteEvent('org-1', 'e-1', organiser);

    expect(written().metadata).toMatchObject({ rsvpCount: 6, attendanceCount: 0 });
  });

  it('keeps the Google id, so a re-import can be recognised', async () => {
    // The importer upserts on it. Without this there is no way to tell a
    // returning event from a new one.
    await service.deleteEvent('org-1', 'e-1', organiser);

    expect(written().metadata.googleEventId).toBe('g-1');
  });

  it('keeps the reservation id, which outlives the event', async () => {
    await service.deleteEvent('org-1', 'e-1', organiser);

    expect(written().metadata.bookingId).toBe('b-1');
  });

  it('records nobody’s name or address', async () => {
    /*
      Numbers, never the people: who had RSVPed is theirs. And an unmatched
      organiser's address is kept to match them if they rejoin (CAL-03) and
      is never displayed — copying it into a log would be a second home for
      it, so the log says only that there was one.
    */
    prisma.event.findFirst.mockImplementation(async (args: any) =>
      args?.select?._count
        ? snapshot({ hostEmail: 'someone@example.net' })
        : { id: 'e-1', isPublished: true, hostId: 'the-host', createdById: 'the-host', tickets: [] },
    );

    await service.deleteEvent('org-1', 'e-1', organiser);

    const json = JSON.stringify(written().metadata);
    expect(json).not.toMatch(/@/);
    expect(written().metadata.hadUnmatchedHost).toBe(true);
  });

  it('says so when there was no unmatched host', async () => {
    await service.deleteEvent('org-1', 'e-1', organiser);

    expect(written().metadata.hadUnmatchedHost).toBe(false);
  });

  it('writes the row and the delete together, or neither', async () => {
    /*
      One transaction. A log of a delete that did not happen is a lie, and a
      delete with no log is the hole this closes — there is no ordering of
      two separate statements that avoids both.
    */
    await service.deleteEvent('org-1', 'e-1', organiser);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('reads the event before destroying it, not after', async () => {
    await service.deleteEvent('org-1', 'e-1', organiser);

    // The snapshot read is the second `findFirst`: the rule's read is first.
    const readAt = prisma.event.findFirst.mock.invocationCallOrder[1];
    const wroteAt = prisma.$transaction.mock.invocationCallOrder[0];
    expect(readAt).toBeLessThan(wroteAt);
  });

  it('writes nothing when the delete was refused', async () => {
    prisma.event.findFirst.mockImplementation(async () => ({
      id: 'e-1',
      isPublished: true,
      hostId: 'the-host',
      createdById: 'the-host',
      tickets: [{ quantity: 2 }],
    }));

    await expect(service.deleteEvent('org-1', 'e-1', organiser)).rejects.toThrow();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
