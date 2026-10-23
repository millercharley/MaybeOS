import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';

/**
 * Seats are summed, never counted (EVT-47).
 *
 * One ticket row used to be one seat, so `count()` and `SUM(quantity)` were
 * the same number everywhere. They still agree on every ticket sold before
 * the selector shipped, which is what makes a stray counter so easy to miss:
 * it is right about all the data there is, until the first person buys two.
 *
 * The expensive version of that mistake is capacity. A 24-seat show sold
 * twelve pairs is full; a row-counter calls it half empty and keeps selling.
 */
const ORG = 'org-1';
const EVENT = 'event-1';

describe('ConnectService — seats', () => {
  const anEvent = (over: Record<string, unknown> = {}) => ({
    id: EVENT,
    orgId: ORG,
    title: 'Dog Sees God',
    startTime: new Date('2026-10-29T23:00:00Z'),
    endTime: new Date('2026-10-30T01:00:00Z'),
    priceCents: 1000,
    currency: 'usd',
    capacity: 24,
    isPublished: true,
    canceledAt: null,
    ticketSalesPaused: false,
    org: {
      id: ORG,
      name: 'MaybeItsFate',
      plan: 'FREE',
      ticketFeeCents: 75,
      stripeAccountId: 'acct_1',
      stripeChargesEnabled: true,
    },
    ...over,
  });

  const build = async (over: { soldSeats?: number; event?: Record<string, unknown> } = {}) => {
    const sessions = { create: jest.fn().mockResolvedValue({ id: 'cs_1', url: 'https://stripe' }) };

    const prisma = {
      event: { findFirst: jest.fn().mockResolvedValue(anEvent(over.event)) },
      ticket: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: over.soldSeats ?? 0 } }),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'ticket-1', ...data })),
      },
      rsvp: { create: jest.fn(), upsert: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
        // Publishing a booking to a connected calendar (CAL-02); these suites
        // sell tickets and touch none.
        { provide: CalendarService, useValue: { syncBooking: jest.fn() } },
      ],
    }).compile();

    const service = module.get(ConnectService);
    // The SDK instance is built in the constructor from config; the checkout
    // call is the only part these tests exercise.
    (service as unknown as { stripe: unknown }).stripe = { checkout: { sessions } };

    return { service, prisma, sessions };
  };

  const checkout = (service: ConnectService, quantity?: number) =>
    service.createTicketCheckout({
      orgId: ORG,
      eventId: EVENT,
      successUrl: 'https://maybeos.org/ok',
      cancelUrl: 'https://maybeos.org/no',
      ...(quantity === undefined ? {} : { quantity }),
    });

  describe('capacity', () => {
    /** The bug a row-counter would have: twelve pairs in a 24-seat room. */
    it('counts seats sold, not purchases', async () => {
      const { service, prisma } = await build({ soldSeats: 24 });

      await expect(checkout(service, 1)).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.ticket.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ _sum: { quantity: true } }),
      );
    });

    it('does not count refunded seats as sold', async () => {
      const { service, prisma } = await build({ soldSeats: 0 });

      await checkout(service, 1);

      expect(prisma.ticket.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventId: EVENT, refundedAt: null } }),
      );
    });

    /** Asking for four with three left must not sell four. */
    it('refuses a purchase that would overshoot what is left', async () => {
      const { service } = await build({ soldSeats: 21 });

      await expect(checkout(service, 4)).rejects.toThrow('Only 3 seats are left');
    });

    /**
     * And says the number. "Sold out" would send somebody away from an event
     * that still has room for them.
     */
    it('says how many are left rather than refusing flatly', async () => {
      const { service } = await build({ soldSeats: 23 });

      await expect(checkout(service, 2)).rejects.toThrow(/Only 1 seat is left/);
    });

    it('allows a purchase that exactly fills the room', async () => {
      const { service, sessions } = await build({ soldSeats: 21 });

      await checkout(service, 3);

      expect(sessions.create).toHaveBeenCalled();
    });

    it('ignores capacity when the event has none', async () => {
      const { service, sessions } = await build({
        soldSeats: 500,
        event: { capacity: null },
      });

      await checkout(service, 5);

      expect(sessions.create).toHaveBeenCalled();
    });
  });

  describe('the Stripe session', () => {
    it('sends the seats as the line item quantity, priced per seat', async () => {
      const { service, sessions } = await build();

      await checkout(service, 3);

      const [params] = sessions.create.mock.calls[0];
      expect(params.line_items[0].quantity).toBe(3);
      expect(params.line_items[0].price_data.unit_amount).toBe(1175);
    });

    /**
     * `adjustable_quantity` would let the buyer change the number on Stripe's
     * page, after the application fee has been fixed as an absolute figure
     * and after capacity has been checked. Neither follows the change.
     */
    it('never lets Stripe adjust the quantity', async () => {
      const { service, sessions } = await build();

      await checkout(service, 2);

      expect(sessions.create.mock.calls[0][0].line_items[0].adjustable_quantity).toBeUndefined();
    });

    it('takes MaybeOS’s fee for every seat', async () => {
      const { service, sessions } = await build();

      await checkout(service, 3);

      expect(
        sessions.create.mock.calls[0][0].payment_intent_data.application_fee_amount,
      ).toBe(300);
    });

    /**
     * The webhook writes these onto the row as how `amountCents` was split,
     * and the payouts are worked out from that table — so a two-seat sale
     * carrying one seat's fee is a receipt that does not add up.
     */
    it('carries purchase totals in the metadata, not per-seat figures', async () => {
      const { service, sessions } = await build();

      await checkout(service, 3);

      expect(sessions.create.mock.calls[0][0].metadata).toMatchObject({
        quantity: '3',
        platformFeeCents: '300',
        orgFeeCents: '225',
      });
    });

    it('still sells one seat when nobody asked for a number', async () => {
      const { service, sessions } = await build();

      await checkout(service);

      expect(sessions.create.mock.calls[0][0].line_items[0].quantity).toBe(1);
      expect(sessions.create.mock.calls[0][0].metadata.quantity).toBe('1');
    });

    it('refuses a quantity that got past the DTO', async () => {
      const { service, sessions } = await build();

      await expect(checkout(service, 999)).rejects.toThrow();
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('recording the sale', () => {
    const session = (metadata: Record<string, string>) =>
      ({
        id: 'cs_live_1',
        currency: 'usd',
        amount_total: 3525,
        payment_intent: 'pi_1',
        customer_details: { email: 'buyer@example.com', name: 'A Buyer' },
        metadata: { kind: 'event_ticket', eventId: EVENT, orgId: ORG, ...metadata },
      }) as never;

    it('stores the seats it sold', async () => {
      const { service, prisma } = await build();

      await service.recordTicketFromSession(session({ quantity: '3' }));

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ quantity: 3 }) }),
      );
    });

    /**
     * The seats beyond the first are the buyer's guests, which is the field
     * the door list already renders and the head count already sums. Three
     * RSVPs would put one name on the list three times — the thing EVT-46
     * had to add a label to explain.
     */
    it('puts the extra seats on the RSVP as guests', async () => {
      const { service, prisma } = await build();

      await service.recordTicketFromSession(session({ quantity: '3' }));

      expect(prisma.rsvp.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plusOnes: 2 }) }),
      );
    });

    it('leaves a single seat with no guests', async () => {
      const { service, prisma } = await build();

      await service.recordTicketFromSession(session({ quantity: '1' }));

      expect(prisma.rsvp.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ plusOnes: 0 }) }),
      );
    });

    /**
     * A member has one RSVP row, by unique index. Buying again has to add to
     * it — replacing would throw away the seats they already hold.
     */
    it('adds to a member’s guests rather than replacing them', async () => {
      const { service, prisma } = await build();

      await service.recordTicketFromSession(
        session({ quantity: '2', userId: 'user-1' }),
      );

      expect(prisma.rsvp.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ plusOnes: 1 }),
          update: expect.objectContaining({ plusOnes: { increment: 1 } }),
        }),
      );
    });

    it.each([
      ['no quantity at all, from a session made before EVT-47', {}],
      ['a quantity of zero', { quantity: '0' }],
      ['an unparseable quantity', { quantity: 'two' }],
    ])('records one seat for %s', async (_label, metadata) => {
      const { service, prisma } = await build();

      await service.recordTicketFromSession(session(metadata));

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ quantity: 1 }) }),
      );
    });
  });
});
