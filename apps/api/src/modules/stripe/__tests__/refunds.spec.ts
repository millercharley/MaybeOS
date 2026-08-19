import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';

/**
 * Refunding tickets.
 *
 * Selling tickets you cannot refund is worse than not selling them, so this
 * covers the two things that decide whether a refund is honest:
 *
 *   1. **MaybeOS gives its fee back.** Under Connect, refunding a charge
 *      returns the buyer's money from the *co-op's* balance and the platform
 *      keeps its application fee unless told otherwise. Left at the default, a
 *      co-op cancelling an event would pay MaybeOS for tickets nobody used.
 *   2. **One failure does not strand the rest.** If Stripe rejects one card,
 *      the other buyers still get their money and somebody is told which one
 *      did not.
 */
describe('ConnectService — refunds', () => {
  let service: ConnectService;
  let prisma: { ticket: Record<string, jest.Mock> };
  let refundsCreate: jest.Mock;

  const ticket = (over: Record<string, unknown> = {}) => ({
    id: 'ticket-1',
    buyerEmail: 'buyer@example.com',
    amountCents: 1055,
    currency: 'usd',
    refundedAt: null,
    stripePaymentIntentId: 'pi_123',
    event: { orgId: 'org-1', org: { stripeAccountId: 'acct_coop' } },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      ticket: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
        {
          provide: CalendarService,
          useValue: { syncBooking: jest.fn().mockResolvedValue({ synced: false }) },
        },
      ],
    }).compile();

    service = module.get<ConnectService>(ConnectService);

    refundsCreate = jest.fn().mockResolvedValue({ id: 're_1' });
    (service as unknown as { stripe: { refunds: { create: jest.Mock } } }).stripe = {
      refunds: { create: refundsCreate },
    } as never;
  });

  describe('a single refund', () => {
    it('gives back the MaybeOS fee as well as the ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket());

      await service.refundTicket('org-1', 'ticket-1');

      const [params] = refundsCreate.mock.calls[0];
      // The whole point. Without this the buyer is repaid out of the co-op's
      // pocket while MaybeOS keeps its cut of an event that did not happen.
      expect(params.refund_application_fee).toBe(true);
      expect(params.payment_intent).toBe('pi_123');
    });

    it('refunds on the co-op\'s account, where the charge was made', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket());

      await service.refundTicket('org-1', 'ticket-1');

      expect(refundsCreate.mock.calls[0][1]).toEqual({ stripeAccount: 'acct_coop' });
    });

    it('marks the ticket refunded so it cannot be refunded twice', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket());

      await service.refundTicket('org-1', 'ticket-1');

      expect(prisma.ticket.update.mock.calls[0][0].data.refundedAt).toBeInstanceOf(Date);
    });

    it('is idempotent — an already-refunded ticket is a no-op, not an error', async () => {
      // A retried cancellation must not double-refund, and "already refunded"
      // is the end state we wanted anyway.
      prisma.ticket.findUnique.mockResolvedValue(ticket({ refundedAt: new Date() }));

      const result = await service.refundTicket('org-1', 'ticket-1');

      expect(result).toEqual({ refunded: false, reason: 'already refunded' });
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('refuses when there is no payment recorded', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket({ stripePaymentIntentId: null }));

      const result = await service.refundTicket('org-1', 'ticket-1');

      expect(result.refunded).toBe(false);
      expect(refundsCreate).not.toHaveBeenCalled();
    });
  });

  describe('refunding a whole event', () => {
    it('refunds every outstanding ticket', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        { id: 't1', buyerEmail: 'a@example.com', amountCents: 1055 },
        { id: 't2', buyerEmail: 'b@example.com', amountCents: 1055 },
      ]);
      prisma.ticket.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(ticket({ id: where.id })),
      );

      const result = await service.refundEventTickets('org-1', 'event-1');

      expect(result).toMatchObject({ attempted: 2, refunded: 2 });
      expect(result.failed).toEqual([]);
    });

    it('only looks at tickets that are not already refunded', async () => {
      await service.refundEventTickets('org-1', 'event-1');

      expect(prisma.ticket.findMany.mock.calls[0][0].where).toEqual({
        eventId: 'event-1',
        refundedAt: null,
      });
    });

    it('keeps going when one refund fails, and names who is still owed', async () => {
      prisma.ticket.findMany.mockResolvedValue([
        { id: 't1', buyerEmail: 'a@example.com', amountCents: 1055 },
        { id: 't2', buyerEmail: 'b@example.com', amountCents: 1055 },
        { id: 't3', buyerEmail: 'c@example.com', amountCents: 1055 },
      ]);
      prisma.ticket.findUnique.mockImplementation(({ where }) =>
        Promise.resolve(ticket({ id: where.id })),
      );
      refundsCreate
        .mockResolvedValueOnce({ id: 're_1' })
        .mockRejectedValueOnce(new Error('card_declined'))
        .mockResolvedValueOnce({ id: 're_3' });

      const result = await service.refundEventTickets('org-1', 'event-1');

      // Two people got their money; the third is named so somebody can chase
      // it. A count alone would not say whose money is missing.
      expect(result.refunded).toBe(2);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({
        ticketId: 't2',
        buyerEmail: 'b@example.com',
        reason: 'card_declined',
      });
    });
  });

  describe('whose ticket it is', () => {
    it("refuses a ticket belonging to another co-op", async () => {
      // The route's guard proves the caller organises *a* co-op, not this one.
      // Before this check the org was ignored entirely — the parameter was
      // named `_orgId` — so the only protection was not knowing the id, and an
      // admin could refund another co-op's sale from that co-op's balance.
      prisma.ticket.findUnique.mockResolvedValue(
        ticket({ event: { orgId: 'someone-elses-org', org: { stripeAccountId: 'acct_them' } } }),
      );

      await expect(service.refundTicket('org-1', 'ticket-1')).rejects.toThrow();
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it('reads as not-found rather than forbidden', async () => {
      // Telling a stranger that a ticket exists but is not theirs confirms the
      // id. There is nothing they can do with either answer, so the quieter
      // one is the right one.
      prisma.ticket.findUnique.mockResolvedValue(
        ticket({ event: { orgId: 'someone-elses-org', org: { stripeAccountId: 'acct_them' } } }),
      );

      await expect(service.refundTicket('org-1', 'ticket-1')).rejects.toThrow(/not found/i);
    });
  });
});
