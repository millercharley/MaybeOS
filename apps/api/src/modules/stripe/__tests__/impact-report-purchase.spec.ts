import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../stripe.service';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';
import {
  WRITTEN_REPORT_PRICE_CENTS,
  WRITTEN_REPORT_CHECKOUT_KIND,
} from '../../impact/report-pricing';

/**
 * The $50 written-report purchase, driven through the webhook (IMP-23).
 *
 * Four kinds of Checkout session land on one signature-verified endpoint —
 * tickets, bookings, the MaybeOS plan, and this. A handler that recognises
 * somebody else's session is how a co-op gets entitled to a report by buying
 * a ticket, so "ignores everything that isn't mine" is asserted first.
 *
 * Driven through `handleWebhook` rather than by calling the private method,
 * for the reason PLT-03 records: a correct handler nothing calls fails
 * silently, and here it fails as a co-op that paid and cannot publish.
 */
describe('StripeService — buying the written impact report', () => {
  let service: StripeService;
  let prisma: any;
  let stripe: any;

  beforeEach(async () => {
    prisma = {
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      organization: { findFirst: jest.fn(), update: jest.fn() },
      userOrg: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
      impactReport: { findFirst: jest.fn() },
      impactReportPurchase: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'p1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'whsec_test' } },
        {
          provide: ConnectService,
          useValue: {
            recordTicketFromSession: jest.fn(),
            confirmBookingFromSession: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    stripe = (service as any).stripe;
    stripe.webhooks = { constructEvent: jest.fn() };
    stripe.checkout = { sessions: { create: jest.fn() } };
  });

  const written = {
    id: 'r1',
    tier: 'WRITTEN',
    title: 'Sunrise: 2026 impact',
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-12-31'),
  };

  // ─── Selling it ──────────────────────────────────────────────

  describe('createImpactReportCheckout', () => {
    beforeEach(() => {
      stripe.checkout.sessions.create.mockResolvedValue({
        id: 'cs_1',
        url: 'https://pay',
      });
    });

    const buy = () =>
      service.createImpactReportCheckout(
        'org1',
        'user1',
        'r1',
        'https://app/ok',
        'https://app/no',
      );

    it('charges $50 once, on MaybeOS’s own account', async () => {
      prisma.impactReport.findFirst.mockResolvedValue(written);

      await expect(buy()).resolves.toMatchObject({ url: 'https://pay' });

      const args = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(args.mode).toBe('payment');
      expect(args.line_items[0].price_data.unit_amount).toBe(WRITTEN_REPORT_PRICE_CENTS);
      expect(args.line_items[0].quantity).toBe(1);
      // No `stripeAccount` second argument: this is not a Connect direct
      // charge. MaybeOS is the seller, not a share of a co-op's revenue.
      expect(stripe.checkout.sessions.create.mock.calls[0][1]).toBeUndefined();
    });

    it('stamps the session so the shared webhook can recognise it', async () => {
      prisma.impactReport.findFirst.mockResolvedValue(written);
      await buy();

      const args = stripe.checkout.sessions.create.mock.calls[0][0];
      expect(args.metadata).toMatchObject({
        kind: WRITTEN_REPORT_CHECKOUT_KIND,
        purchaseId: 'p1',
        orgId: 'org1',
        reportId: 'r1',
      });
    });

    it('records the purchase before sending anyone to Stripe', async () => {
      prisma.impactReport.findFirst.mockResolvedValue(written);
      await buy();

      // A session created with no row behind it is a payment the webhook
      // cannot settle.
      const createdAt = prisma.impactReportPurchase.create.mock.invocationCallOrder[0];
      const sessionAt = stripe.checkout.sessions.create.mock.invocationCallOrder[0];
      expect(createdAt).toBeLessThan(sessionAt);

      expect(prisma.impactReportPurchase.create.mock.calls[0][0].data).toMatchObject({
        orgId: 'org1',
        amountCents: WRITTEN_REPORT_PRICE_CENTS,
        periodStart: written.periodStart,
        periodEnd: written.periodEnd,
      });
    });

    it('refuses to sell the free report', async () => {
      prisma.impactReport.findFirst.mockResolvedValue({ ...written, tier: 'BASIC' });

      await expect(buy()).rejects.toThrow(/free/i);
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('refuses to charge twice for a period already paid for', async () => {
      prisma.impactReport.findFirst.mockResolvedValue(written);
      prisma.impactReportPurchase.findMany.mockResolvedValue([
        { id: 'p0', status: 'PAID', periodStart: written.periodStart, periodEnd: written.periodEnd },
      ]);

      await expect(buy()).rejects.toThrow(/already paid for/i);
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('looks the report up inside the org', async () => {
      prisma.impactReport.findFirst.mockResolvedValue(written);
      await buy();

      // SEC-04: a report id alone must never be enough to buy against
      // somebody else's co-op.
      expect(prisma.impactReport.findFirst.mock.calls[0][0].where).toMatchObject({
        id: 'r1',
        orgId: 'org1',
      });
    });
  });

  // ─── Settling it ─────────────────────────────────────────────

  describe('the webhook', () => {
    const fire = async (session: Record<string, unknown>) => {
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { object: session },
      });
      return service.handleWebhook(Buffer.from('body'), 'sig');
    };

    const paidSession = (over: Record<string, unknown> = {}) => ({
      id: 'cs_1',
      payment_status: 'paid',
      payment_intent: 'pi_1',
      metadata: {
        kind: WRITTEN_REPORT_CHECKOUT_KIND,
        purchaseId: 'p1',
        orgId: 'org1',
      },
      ...over,
    });

    it('marks the purchase paid', async () => {
      await fire(paidSession());

      expect(prisma.impactReportPurchase.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1', status: 'PENDING' },
          data: expect.objectContaining({
            status: 'PAID',
            stripePaymentIntentId: 'pi_1',
          }),
        }),
      );
    });

    it('ignores a ticket sale', async () => {
      await fire({ id: 'cs_2', payment_status: 'paid', metadata: { kind: 'event_ticket' } });
      expect(prisma.impactReportPurchase.updateMany).not.toHaveBeenCalled();
    });

    it('ignores a plan subscription, which carries no metadata at all', async () => {
      await fire({ id: 'cs_3', mode: 'subscription', client_reference_id: 'org1' });
      expect(prisma.impactReportPurchase.updateMany).not.toHaveBeenCalled();
    });

    it('does not entitle on a payment that has not arrived', async () => {
      // `completed` fires for asynchronous methods before the money lands.
      await fire(paidSession({ payment_status: 'unpaid' }));
      expect(prisma.impactReportPurchase.updateMany).not.toHaveBeenCalled();
    });

    it('is idempotent: a redelivery does not restamp paidAt', async () => {
      // The PENDING filter means the second delivery matches nothing, so the
      // real payment time survives Stripe's retries.
      prisma.impactReportPurchase.updateMany.mockResolvedValue({ count: 0 });

      await expect(fire(paidSession())).resolves.not.toThrow();
    });
  });
});
