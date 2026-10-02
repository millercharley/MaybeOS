import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';

/**
 * Hiding and deleting an event (EVT-30).
 *
 * Charley, after importing 777 events: "Make sure as an admin, I have the
 * ability to hide or delete any events (I see duplicate events that were
 * duplicated in my google calendar)."
 *
 * Two different acts. Hiding keeps everything and takes it off the members'
 * lists, which is right for a duplicate or something announced early.
 * Deleting is the one action on an event that cannot be taken back, so it
 * refuses anything somebody is already expecting.
 */

describe('hiding and deleting', () => {
  let service: EventsService;
  let prisma: any;

  const found = (counts: { rsvps?: number; tickets?: number } = {}) => ({
    id: 'e-1',
    isPublished: true,
    _count: { rsvps: counts.rsvps ?? 0, tickets: counts.tickets ?? 0 },
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
      .catch(async () => {
        // The service takes more collaborators than this test needs; build it
        // directly rather than teaching the module about all of them.
        return null as never;
      });

    service = module
      ? module.get(EventsService)
      : (new (EventsService as any)(prisma) as EventsService);
  });

  describe('hiding', () => {
    it('takes it off the members’ lists', async () => {
      await service.unpublish('org-1', 'e-1');

      expect(prisma.event.update).toHaveBeenCalledWith({
        where: { id: 'e-1' },
        data: { isPublished: false },
      });
    });

    it('destroys nothing', async () => {
      await service.unpublish('org-1', 'e-1');

      expect(prisma.event.delete).not.toHaveBeenCalled();
    });

    it('refuses an event in another co-op', async () => {
      prisma.event.findFirst.mockResolvedValue(null);

      await expect(service.unpublish('org-1', 'e-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleting', () => {
    it('deletes one nobody is expecting', async () => {
      const result = await service.deleteEvent('org-1', 'e-1');

      expect(prisma.event.delete).toHaveBeenCalledWith({ where: { id: 'e-1' } });
      expect(result).toEqual({ deleted: true });
    });

    it('refuses one a member has in their diary', async () => {
      prisma.event.findFirst.mockResolvedValue(found({ rsvps: 3 }));

      await expect(service.deleteEvent('org-1', 'e-1')).rejects.toThrow(BadRequestException);
      expect(prisma.event.delete).not.toHaveBeenCalled();
    });

    it('refuses one somebody paid for', async () => {
      prisma.event.findFirst.mockResolvedValue(found({ tickets: 2 }));

      await expect(service.deleteEvent('org-1', 'e-1')).rejects.toThrow(/tickets have been sold/);
    });

    it('says how many, and what to do instead', async () => {
      // "Cannot delete" with no number is a dead end.
      prisma.event.findFirst.mockResolvedValue(found({ rsvps: 1 }));

      await expect(service.deleteEvent('org-1', 'e-1')).rejects.toThrow(
        /1 member is expecting this event[\s\S]*Cancel it instead/,
      );
    });

    it('counts a ticket before an RSVP, because money is the stronger reason', async () => {
      prisma.event.findFirst.mockResolvedValue(found({ rsvps: 5, tickets: 1 }));

      await expect(service.deleteEvent('org-1', 'e-1')).rejects.toThrow(/ticket has been sold/);
    });
  });
});

describe('who may do it', () => {
  const controller = readFileSync(join(__dirname, '..', 'events.controller.ts'), 'utf8');
  const route = (marker: string) => controller.slice(controller.indexOf(marker), controller.indexOf(marker) + 500);

  it('lets organisers hide, because un-publishing somebody else’s is moderation', () => {
    expect(route("@Post('orgs/:orgId/events/:eventId/unpublish')")).toMatch(
      /@Roles\('ADMIN', 'STAFF'\)/,
    );
  });

  it('lets only an admin delete', () => {
    // The one action on an event that cannot be undone.
    expect(route("@Delete('orgs/:orgId/events/:eventId')")).toMatch(/@Roles\('ADMIN'\)/);
  });
});
