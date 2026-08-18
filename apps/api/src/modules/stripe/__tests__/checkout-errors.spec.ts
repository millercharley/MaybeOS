import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';

/**
 * What a buyer is told when Stripe refuses.
 *
 * Stripe writes its errors for the developer holding the key, and says so
 * literally. A permissions failure on 2026-08-18 rendered onto the event page
 * a member was buying from: the restricted key `rk_live_****BuW4ie`, the
 * connected account id, the exact scope required, and a dashboard link to edit
 * it.
 *
 * Two problems in one. A buyer can act on none of it, so the page is both
 * broken and incomprehensible; and it publishes a fragment of a live
 * credential and the platform's account id to anyone who opens the event.
 * The key fragment is not usable on its own — but a checkout page is the last
 * place to be relaxed about either.
 */
describe('ConnectService — what a failed checkout says', () => {
  let service: ConnectService;
  let sessionsCreate: jest.Mock;

  const stripeRefusal = new Error(
    "Permission denied. The provided key 'rk_live_****BuW4ie' does not have the required " +
      "permissions for this endpoint on account 'acct_1MhgKwDaRqv0hdwb'. Enabling " +
      '"Checkout Sessions Write" (\'checkout_session_write\') permissions on this key would ' +
      'allow this request to continue. You can edit permissions at https://dashboard.stripe.com/...',
  );

  beforeEach(async () => {
    const prisma = {
      event: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'event-1',
          title: '$10 Test',
          currency: 'usd',
          priceCents: 1000,
          startTime: new Date('2126-08-20T18:00:00Z'),
          // Far future: the service refuses a checkout for an event that has
          // already happened, and a fixed past date would make this test start
          // failing on its own one day.
          endTime: new Date('2126-08-20T19:00:00Z'),
          isPublished: true,
          canceledAt: null,
          capacity: null,
          _count: { tickets: 0 },
          org: {
            id: 'org-1',
            name: 'MaybeItsFate',
            plan: 'FREE',
            ticketFeeCents: 145,
            stripeAccountId: 'acct_coop',
            stripeChargesEnabled: true,
          },
        }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ConnectService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
        { provide: CalendarService, useValue: { syncBooking: jest.fn() } },
      ],
    }).compile();

    service = module.get<ConnectService>(ConnectService);

    sessionsCreate = jest.fn().mockRejectedValue(stripeRefusal);
    (service as unknown as { stripe: unknown }).stripe = {
      checkout: { sessions: { create: sessionsCreate } },
    } as never;
  });

  const buy = () =>
    service.createTicketCheckout({
      orgId: 'org-1',
      eventId: 'event-1',
      successUrl: 'https://maybeos.org/ok',
      cancelUrl: 'https://maybeos.org/no',
    });

  it('never shows the buyer the API key or the account id', async () => {
    await expect(buy()).rejects.toBeInstanceOf(BadRequestException);

    const message = await buy().catch((err) => String(err.message));

    expect(message).not.toContain('rk_live_');
    expect(message).not.toContain('acct_');
    expect(message).not.toContain('checkout_session_write');
    expect(message).not.toContain('dashboard.stripe.com');
  });

  it('says plainly that nothing was charged', async () => {
    // The buyer's first question, and the one Stripe's message never answers.
    const message = await buy().catch((err) => String(err.message));
    expect(message).toMatch(/nothing has been charged/i);
  });
});
