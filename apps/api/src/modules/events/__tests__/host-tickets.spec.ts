import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * Tickets and the waitlist, for whoever runs the event (EVT-41).
 *
 * Charley: "When a member is selling tickets to an event they are hosting or
 * co-hosting, they need visibility into ticket sales, who bought tickets, and
 * an option to refund a person. Also add an option to pause ticket sales...
 * And where do hosts see and manage the waitlist if there is one?"
 *
 * Nowhere, was the answer to the last one. The engine has worked since
 * EventOS was built — over capacity a guest is WAITLISTED and a cancellation
 * promotes the first of them — but no screen listed those people.
 *
 * These tests are mostly about the boundary, because widening who may act on
 * an event is the kind of change that is right until it is one id too far.
 */
describe('EventsService — the host side of an event', () => {
  const ORG = 'org-1';
  const EVENT = 'event-1';
  const HOST = 'host-1';
  const STRANGER = 'nobody-1';

  const build = async (over: { coHosts?: string[]; event?: unknown } = {}) => {
    const event = over.event ?? {
      id: EVENT,
      orgId: ORG,
      hostId: HOST,
      createdById: HOST,
      capacity: 10,
    };

    const prisma = {
      event: {
        findFirst: jest.fn().mockResolvedValue(event),
        findUnique: jest.fn().mockResolvedValue(event),
        update: jest.fn().mockImplementation(({ data }) => ({ id: EVENT, ...data })),
      },
      eventCoHost: {
        findMany: jest
          .fn()
          .mockResolvedValue((over.coHosts ?? []).map((userId) => ({ userId }))),
      },
      rsvp: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(3),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendWaitlistPromoted: jest.fn() } },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    return { service: module.get(EventsService), prisma };
  };

  describe('pausing ticket sales', () => {
    it('lets the host stop selling', async () => {
      const { service, prisma } = await build();

      await service.setTicketSales(ORG, EVENT, HOST, false, true);

      expect(prisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { ticketSalesPaused: true } }),
      );
    });

    it('lets a co-host stop selling too', async () => {
      // Somebody asked to help run the evening is running the evening.
      const { service, prisma } = await build({ coHosts: ['co-1'] });

      await service.setTicketSales(ORG, EVENT, 'co-1', false, true);

      expect(prisma.event.update).toHaveBeenCalled();
    });

    it('refuses somebody who does not run it', async () => {
      const { service, prisma } = await build();

      await expect(service.setTicketSales(ORG, EVENT, STRANGER, false, true)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.event.update).not.toHaveBeenCalled();
    });

    it('is a separate thing from unpublishing or cancelling', async () => {
      // The whole point: the event stays where it is and the people already
      // coming stay coming. Nothing else on the row may move.
      const { service, prisma } = await build();

      await service.setTicketSales(ORG, EVENT, HOST, false, true);

      const { data } = prisma.event.update.mock.calls[0][0];
      expect(Object.keys(data)).toEqual(['ticketSalesPaused']);
    });
  });

  describe('the waitlist', () => {
    it('lists who is waiting, in the order they asked', async () => {
      const { service, prisma } = await build();
      prisma.rsvp.findMany.mockResolvedValue([
        { id: 'r1', userId: 'u1', plusOnes: 0, createdAt: new Date('2026-10-01'), user: { id: 'u1', name: 'First', avatarUrl: null } },
        { id: 'r2', userId: 'u2', plusOnes: 1, createdAt: new Date('2026-10-02'), user: { id: 'u2', name: 'Second', avatarUrl: null } },
      ]);

      const result = await service.listWaitlist(ORG, EVENT, HOST, false);

      expect(result.waiting.map((w) => w.position)).toEqual([1, 2]);
      expect(result.waiting[0].name).toBe('First');
      // The order is the promise the automatic promotion already keeps.
      expect(prisma.rsvp.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
    });

    it('says how many places are free', async () => {
      const { service } = await build();

      // Capacity 10, three confirmed.
      await expect(service.listWaitlist(ORG, EVENT, HOST, false)).resolves.toMatchObject({
        confirmed: 3,
        spareSeats: 7,
      });
    });

    it('says nothing about free places when there is no capacity', async () => {
      // An event with no cap cannot be full, so a number here would be a
      // fiction somebody might act on.
      const { service } = await build({
        event: { id: EVENT, orgId: ORG, hostId: HOST, createdById: HOST, capacity: null },
      });

      await expect(service.listWaitlist(ORG, EVENT, HOST, false)).resolves.toMatchObject({
        spareSeats: null,
      });
    });

    it('refuses somebody who does not run the event', async () => {
      const { service } = await build();

      await expect(service.listWaitlist(ORG, EVENT, STRANGER, false)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('gives a named person a place', async () => {
      const { service, prisma } = await build();
      prisma.rsvp.findFirst.mockResolvedValue({ id: 'r1', eventId: EVENT, status: 'WAITLISTED' });

      await service.promoteFromWaitlist(ORG, EVENT, 'r1', HOST, false);

      expect(prisma.rsvp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CONFIRMED' } }),
      );
    });

    it('will not promote an RSVP from another event', async () => {
      // The rsvp id comes from the URL. Scoped to the event, never taken on
      // trust (SEC-04).
      const { service, prisma } = await build();
      prisma.rsvp.findFirst.mockResolvedValue(null);

      await expect(
        service.promoteFromWaitlist(ORG, EVENT, 'someone-elses', HOST, false),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.rsvp.update).not.toHaveBeenCalled();
    });

    it('asks only for people who are actually waiting', async () => {
      const { service, prisma } = await build();
      prisma.rsvp.findFirst.mockResolvedValue({ id: 'r1', eventId: EVENT, status: 'WAITLISTED' });

      await service.promoteFromWaitlist(ORG, EVENT, 'r1', HOST, false);

      // Promoting somebody already confirmed would email them to say they
      // are in, which they know.
      expect(prisma.rsvp.findFirst.mock.calls[0][0].where).toMatchObject({
        eventId: EVENT,
        status: 'WAITLISTED',
      });
    });
  });
});
