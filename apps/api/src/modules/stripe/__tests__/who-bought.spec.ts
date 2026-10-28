import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';

/**
 * Who may see who bought a ticket (EVT-51, EVT-33).
 *
 * Charley: "Make sure an Admin can open Payouts and click through any event
 * to see who bought tickets to the specific event (as an Admin). Make sure
 * the host can see this info too to check people in."
 *
 * Both already worked; neither was tested. The route answers with buyers'
 * names and email addresses, so the boundary around it is the kind that is
 * fine until somebody widens it for a good reason and nothing says no.
 *
 * It is deliberately *not* a role: a host is an ordinary member, and the
 * event is theirs. Charley, when EVT-33 was written: "any host, co-host and
 * admin can… review who has bought tickets."
 */
const ORG = 'org-1';
const EVENT = 'event-1';
const HOST = 'host-1';
const CO_HOST = 'cohost-1';
const CREATOR = 'creator-1';
const STRANGER = 'member-9';

describe('ConnectService — who bought tickets', () => {
  const build = async (event: Record<string, unknown> | null = {}) => {
    const row =
      event === null
        ? null
        : {
            id: EVENT,
            hostId: HOST,
            createdById: CREATOR,
            coHosts: [{ userId: CO_HOST }],
            ...event,
          };

    const prisma = {
      event: { findFirst: jest.fn().mockResolvedValue(row) },
      ticket: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            buyerEmail: 'annette@example.com',
            buyerName: 'Annette M Neblett',
            amountCents: 1175,
            quantity: 2,
          },
        ]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
        { provide: CalendarService, useValue: { syncBooking: jest.fn() } },
      ],
    }).compile();

    return { service: module.get(ConnectService), prisma };
  };

  describe('who is allowed', () => {
    it('lets an organiser through without even loading the event', async () => {
      const { service, prisma } = await build();

      await expect(
        service.assertRunsEvent(ORG, EVENT, { userId: STRANGER, isOrganiser: true }),
      ).resolves.toBeUndefined();

      // An admin may read any of their co-op's events; there is nothing to check.
      expect(prisma.event.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      ['the host', HOST],
      ['a co-host', CO_HOST],
      ['whoever created it', CREATOR],
    ])('lets %s through', async (_label, userId) => {
      const { service } = await build();

      await expect(
        service.assertRunsEvent(ORG, EVENT, { userId, isOrganiser: false }),
      ).resolves.toBeUndefined();
    });

    /** Buyers' names and addresses. A member of the co-op is not enough. */
    it('refuses a member who does not run it', async () => {
      const { service } = await build();

      await expect(
        service.assertRunsEvent(ORG, EVENT, { userId: STRANGER, isOrganiser: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    /**
     * Scoped through the co-op, not by event id alone (SEC-04). A host of one
     * co-op's event must not reach another co-op's by guessing an id.
     */
    it('refuses an event that is not this co-op’s', async () => {
      const { service, prisma } = await build(null);

      await expect(
        service.assertRunsEvent(ORG, EVENT, { userId: HOST, isOrganiser: false }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.event.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: EVENT, orgId: ORG } }),
      );
    });

    /** An event with no host at all is nobody's but an organiser's. */
    it('refuses a member when the event has no host or creator', async () => {
      const { service } = await build({ hostId: null, createdById: null, coHosts: [] });

      await expect(
        service.assertRunsEvent(ORG, EVENT, { userId: HOST, isOrganiser: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('what the list returns', () => {
    it('reads the tickets through the co-op, never by event id alone', async () => {
      const { service, prisma } = await build();

      await service.listTicketsForEvent(ORG, EVENT);

      expect(prisma.event.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: EVENT, orgId: ORG } }),
      );
      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventId: EVENT } }),
      );
    });

    it('refuses an event belonging to another co-op', async () => {
      const { service, prisma } = await build(null);

      await expect(service.listTicketsForEvent(ORG, EVENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.ticket.findMany).not.toHaveBeenCalled();
    });

    /**
     * The door needs a name to read out and a way to tell two buyers apart;
     * it does not need the card, the Stripe session or the payment intent.
     */
    it('asks for what a door and a refund need, and no payment identifiers', async () => {
      const { service, prisma } = await build();

      await service.listTicketsForEvent(ORG, EVENT);

      const { select } = prisma.ticket.findMany.mock.calls[0][0];
      expect(select).toMatchObject({ buyerName: true, buyerEmail: true, refundedAt: true });
      expect(select.stripeSessionId).toBeUndefined();
      expect(select.stripePaymentIntentId).toBeUndefined();
    });
  });
});
