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

  beforeEach(async () => {
    prisma = {
      event: {
        findFirst: jest.fn().mockResolvedValue(found()),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
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
