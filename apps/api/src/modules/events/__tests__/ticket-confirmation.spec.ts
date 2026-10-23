import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TicketPassService, placeOf } from '../ticket-pass.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { decodeTicketPass, encodeTicketPass } from '../ticket-pass';

/**
 * Telling a ticket buyer they bought a ticket (EVT-46).
 *
 * Eight tickets had been sold on the live account and not one buyer had been
 * emailed anything, because nothing ever sent them anything. Annette Neblett
 * found it: "I have purchased 2 tickets and have not received them yet."
 *
 * The tests that matter here are the ones about *not* sending twice and *not*
 * marking something sent that did not go — the two ways a confirmation
 * becomes permanently missing rather than merely late.
 */
describe('TicketPassService', () => {
  const SECRET = 'test-secret';
  const EVENT = 'event-1';
  const EMAIL = 'netneb1958@gmail.com';

  const anEvent = (over: Record<string, unknown> = {}) => ({
    title: 'Dog Sees God',
    slug: 'dog-sees-god',
    startTime: new Date('2026-10-29T23:00:00Z'),
    endTime: new Date('2026-10-30T01:00:00Z'),
    timezone: 'America/New_York',
    canceledAt: null,
    org: { name: 'MaybeItsFate', slug: 'maybeitsfate', replyToEmail: 'hello@example.com' },
    location: { name: 'The Gallery', address: '123 Main St', city: 'Louisville', state: 'KY' },
    ...over,
  });

  const aTicket = (over: Record<string, unknown> = {}) => ({
    id: 'ticket-1',
    eventId: EVENT,
    buyerEmail: EMAIL,
    buyerName: 'Annette M Neblett',
    amountCents: 1175,
    refundedAt: null,
    confirmationSentAt: null,
    event: anEvent(),
    ...over,
  });

  const build = (over: { ticket?: unknown; seats?: number; sent?: boolean } = {}) => {
    const prisma = {
      ticket: {
        findUnique: jest.fn().mockResolvedValue(
          over.ticket === undefined ? aTicket() : over.ticket,
        ),
        findFirst: jest.fn().mockResolvedValue({
          buyerName: 'Annette M Neblett',
          createdAt: new Date('2026-10-22T15:57:14Z'),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        // Seats are summed, not counted (EVT-47): one row can be several.
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: over.seats ?? 1 } }),
        update: jest.fn().mockResolvedValue({}),
      },
      event: { findUnique: jest.fn().mockResolvedValue({ id: EVENT, ...anEvent() }) },
    };

    const email = {
      sendTicketConfirmation: jest.fn().mockResolvedValue(over.sent ?? true),
    };

    const config = {
      get: (key: string) =>
        ({ JWT_SECRET: SECRET, WEB_URL: 'https://maybeos.org' })[key],
    };

    return { prisma, email, config };
  };

  const make = async (over: Parameters<typeof build>[0] = {}) => {
    const { prisma, email, config } = build(over);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketPassService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    return { service: module.get(TicketPassService), prisma, email };
  };

  describe('confirm', () => {
    it('sends the confirmation and records that it went', async () => {
      const { service, prisma, email } = await make();

      await expect(service.confirm('ticket-1')).resolves.toBe(true);

      expect(email.sendTicketConfirmation).toHaveBeenCalledTimes(1);
      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { confirmationSentAt: expect.any(Date) },
      });
    });

    /**
     * Annette's actual case. Two checkouts twenty-four seconds apart, because
     * Checkout offers no quantity selector — so the email has to count what
     * the address holds rather than what this one row cost.
     */
    it('counts every seat the address holds, not the one just bought', async () => {
      const { service, email } = await make({ seats: 2 });

      await service.confirm('ticket-1');

      expect(email.sendTicketConfirmation).toHaveBeenCalledWith(
        EMAIL,
        expect.objectContaining({ seats: 2, amountCents: 1175 }),
      );
    });

    it('sends a pass link that decodes back to this event and buyer', async () => {
      const { service, email } = await make();

      await service.confirm('ticket-1');

      const { passUrl } = email.sendTicketConfirmation.mock.calls[0][1];
      const token = new URL(passUrl).searchParams.get('token');

      expect(decodeTicketPass(token ?? undefined, SECRET)).toEqual({
        eventId: EVENT,
        email: EMAIL,
      });
    });

    /**
     * The credential must not be in the path.
     *
     * `lib/api.ts` states the rule and `safePath` enforces it client-side: a
     * token in a path segment reaches Sentry transaction names.
     */
    it('puts the token in the query string, never the path', async () => {
      const { service, email } = await make();

      await service.confirm('ticket-1');

      const url = new URL(email.sendTicketConfirmation.mock.calls[0][1].passUrl);
      expect(url.pathname).toBe('/pass');
      expect(url.searchParams.get('token')).toBeTruthy();
    });

    /** Running the webhook and the sweep over one row must send once. */
    it('does nothing for a ticket already confirmed', async () => {
      const { service, prisma, email } = await make({
        ticket: aTicket({ confirmationSentAt: new Date('2026-10-22T16:00:00Z') }),
      });

      await expect(service.confirm('ticket-1')).resolves.toBe(false);

      expect(email.sendTicketConfirmation).not.toHaveBeenCalled();
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    /**
     * The SRV-03 mistake, which is why `send` was given a return value: mark
     * before you know and a Postmark failure becomes permanent silence.
     */
    it('leaves the row unmarked when the provider refuses it', async () => {
      const { service, prisma } = await make({ sent: false });

      await expect(service.confirm('ticket-1')).resolves.toBe(false);

      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    it.each([
      ['refunded', aTicket({ refundedAt: new Date() })],
      ['cancelled', aTicket({ event: anEvent({ canceledAt: new Date() }) })],
    ])('does not tell somebody a %s ticket is confirmed', async (_label, ticket) => {
      const { service, prisma, email } = await make({ ticket });

      await expect(service.confirm('ticket-1')).resolves.toBe(false);

      expect(email.sendTicketConfirmation).not.toHaveBeenCalled();
      // Marked anyway, so the sweep stops looking at it.
      expect(prisma.ticket.update).toHaveBeenCalled();
    });

    /**
     * `'unknown'` is what `recordTicketFromSession` writes when Stripe gave us
     * no address. Mailing it would bounce, and a bounce is what damages a
     * sending reputation — the thing EML-01..05 was all about.
     */
    it('does not try to mail a ticket with no usable address', async () => {
      const { service, prisma, email } = await make({
        ticket: aTicket({ buyerEmail: 'unknown' }),
      });

      await expect(service.confirm('ticket-1')).resolves.toBe(false);

      expect(email.sendTicketConfirmation).not.toHaveBeenCalled();
      // Left unmarked: if the address is ever corrected, it should still go.
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    /**
     * Asserted on the query, because the seats are counted by Postgres and
     * the Prisma client here is a mock. Both clauses are load-bearing and
     * neither is visible in any other test:
     *
     * - `insensitive`, because Stripe returns the address as the buyer typed
     *   it and one person's two checkouts can disagree about a capital. Lose
     *   this and Annette holds "1 seat" at a door she paid for twice.
     * - `refundedAt: null`, because a refund is the co-op taking the seat
     *   back. Lose this and a refunded pass still admits somebody.
     */
    it('counts seats case-insensitively and ignores refunded ones', async () => {
      const { service, prisma } = await make();

      await service.confirm('ticket-1');

      expect(prisma.ticket.aggregate).toHaveBeenCalledWith({
        where: {
          eventId: EVENT,
          buyerEmail: { equals: EMAIL, mode: 'insensitive' },
          refundedAt: null,
        },
        // Summed. A `count()` here shows somebody who bought three in one go
        // a pass reading "1 seat", and is right about every row sold before
        // the selector existed — which is what would hide it.
        _sum: { quantity: true },
      });
    });

    it('does nothing for a ticket that is not there', async () => {
      const { service, email } = await make({ ticket: null });

      await expect(service.confirm('ticket-1')).resolves.toBe(false);
      expect(email.sendTicketConfirmation).not.toHaveBeenCalled();
    });
  });

  describe('viewPass', () => {
    // Minted directly rather than round-tripped through an email, so a test
    // about reading a pass fails for reasons about reading a pass.
    const aToken = (over: { eventId?: string; email?: string } = {}) =>
      encodeTicketPass({ eventId: over.eventId ?? EVENT, email: over.email ?? EMAIL }, SECRET);

    it('shows the seats an address holds', async () => {
      const { service } = await make({ seats: 2 });

      const pass = await service.viewPass(aToken());

      expect(pass).toMatchObject({
        seats: 2,
        holder: { name: 'Annette M Neblett', email: EMAIL },
        event: { title: 'Dog Sees God', orgName: 'MaybeItsFate', canceled: false },
      });
    });

    /** The time at the door is the event's time, not the phone's (SPC-08). */
    it('formats the time in the event timezone', async () => {
      const { service } = await make();

      const pass = await service.viewPass(aToken());

      // 23:00 UTC is 7pm in New York, not 11pm.
      expect(pass?.event.when).toContain('7:00 PM');
    });

    it('refuses a forged token', async () => {
      const { service } = await make();

      await expect(service.viewPass('not.a.token')).resolves.toBeNull();
    });

    /**
     * A refunded buyer gets the same answer as a forgery. Anything else lets
     * somebody with a guessed token ask whether it named a real sale.
     */
    it('refuses a token for an address holding no seats', async () => {
      const { service } = await make({ seats: 0 });

      await expect(service.viewPass(aToken())).resolves.toBeNull();
    });

    /**
     * A token whose signature is fine but whose event has been deleted. Same
     * null as a forgery — the page must not become a way to ask which events
     * exist.
     */
    it('refuses a token for an event that is gone', async () => {
      const { prisma, email, config } = build();
      prisma.event.findUnique = jest.fn().mockResolvedValue(null);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TicketPassService,
          { provide: PrismaService, useValue: prisma },
          { provide: EmailService, useValue: email },
          { provide: ConfigService, useValue: config },
        ],
      }).compile();

      await expect(module.get(TicketPassService).viewPass(aToken())).resolves.toBeNull();
    });
  });

  describe('sweep', () => {
    it('sends to everybody still owed one, oldest first', async () => {
      const { prisma, email, config } = build();
      prisma.ticket.findMany = jest
        .fn()
        .mockResolvedValue([{ id: 't1' }, { id: 't2' }, { id: 't3' }]);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TicketPassService,
          { provide: PrismaService, useValue: prisma },
          { provide: EmailService, useValue: email },
          { provide: ConfigService, useValue: config },
        ],
      }).compile();

      await expect(module.get(TicketPassService).sweep()).resolves.toEqual({
        sent: 3,
        failed: 0,
      });

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { confirmationSentAt: null, refundedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    /** One unmailable row must not strand the people behind it. */
    it('keeps going when one ticket throws', async () => {
      const { prisma, email, config } = build();
      prisma.ticket.findMany = jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      prisma.ticket.findUnique = jest
        .fn()
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockResolvedValue(aTicket());

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TicketPassService,
          { provide: PrismaService, useValue: prisma },
          { provide: EmailService, useValue: email },
          { provide: ConfigService, useValue: config },
        ],
      }).compile();

      await expect(module.get(TicketPassService).sweep()).resolves.toEqual({
        sent: 1,
        failed: 1,
      });
    });

    /** Netlify gives the scheduler about ten seconds. */
    it('is bounded', async () => {
      const { prisma, email, config } = build();
      prisma.ticket.findMany = jest.fn().mockResolvedValue([]);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TicketPassService,
          { provide: PrismaService, useValue: prisma },
          { provide: EmailService, useValue: email },
          { provide: ConfigService, useValue: config },
        ],
      }).compile();

      await module.get(TicketPassService).sweep();

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: expect.any(Number) }),
      );
    });
  });

  describe('placeOf', () => {
    it('reads as one line', () => {
      expect(
        placeOf({ name: 'The Gallery', address: '123 Main St', city: 'Louisville', state: 'KY' }),
      ).toBe('The Gallery · 123 Main St · Louisville, KY');
    });

    it('says only what the co-op filled in', () => {
      expect(placeOf({ name: 'The Gallery', address: null, city: null, state: null })).toBe(
        'The Gallery',
      );
    });

    /** Null, not "TBA" — a pass should not raise a question it cannot answer. */
    it('is null when there is no location at all', () => {
      expect(placeOf(null)).toBeNull();
    });
  });
});
