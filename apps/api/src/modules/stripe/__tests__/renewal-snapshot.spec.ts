import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../stripe.service';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';

const PLUS_MONTHLY = 'price_1U6M1VD14bhghVE2lprg1qo0';
const UNLIMITED_MONTHLY = 'price_1U6LvpD14bhghVE2Grl0L9DI';

/**
 * Billing Plus by member count actually happens (PLT-03).
 *
 * The quantity logic and the price allowlist were each tested in isolation,
 * and neither proves the webhook reaches them. That gap is how `TouchpointAsk`
 * shipped with zero importers and IMP-15 read as done while asking nobody
 * anything — a correct handler nothing calls fails silently, and here it fails
 * as an invoice for the wrong amount.
 *
 * So everything below is driven through `handleWebhook`, not by calling the
 * private methods.
 */
describe('StripeService — per-member billing through the webhook', () => {
  let service: StripeService;
  let prisma: any;
  let stripe: any;

  beforeEach(async () => {
    prisma = {
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      organization: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      userOrg: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(37),
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
          useValue: { recordTicketFromSession: jest.fn(), confirmBookingFromSession: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    stripe = (service as any).stripe;
    stripe.webhooks = { constructEvent: jest.fn() };
    stripe.subscriptions = { retrieve: jest.fn() };
    stripe.subscriptionItems = { update: jest.fn().mockResolvedValue({}) };
  });

  const itemsOf = (priceId: string, quantity = 1) => ({
    items: { data: [{ id: 'si_1', quantity, price: { id: priceId } }] },
  });

  const fire = async (event: unknown) => {
    stripe.webhooks.constructEvent.mockReturnValue(event);
    return service.handleWebhook(Buffer.from('body'), 'sig');
  };

  const upcoming = (subscriptionId: string) => ({
    id: `evt_${subscriptionId}`,
    type: 'invoice.upcoming',
    data: { object: { subscription: subscriptionId } },
  });

  const completed = (over: Record<string, unknown> = {}) => ({
    id: 'evt_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1',
        mode: 'subscription',
        client_reference_id: 'org-1',
        subscription: 'sub_plus',
        customer: 'cus_1',
        ...over,
      },
    },
  });

  /* ─── At renewal ─────────────────────────────────────────── */

  describe('at renewal', () => {
    it('sets the quantity to the co-op’s member count', async () => {
      prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
      stripe.subscriptions.retrieve.mockResolvedValue(itemsOf(PLUS_MONTHLY));

      await fire(upcoming('sub_plus'));

      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith('si_1', {
        quantity: 37,
        // Nothing at renewal: the snapshot is meant to be one predictable
        // bill, not a proration every time somebody joins.
        proration_behavior: 'none',
      });
    });

    it('counts organisers, staff and members — never guests', async () => {
      prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
      stripe.subscriptions.retrieve.mockResolvedValue(itemsOf(PLUS_MONTHLY));

      await fire(upcoming('sub_plus'));

      expect(prisma.userOrg.count).toHaveBeenCalledWith({
        where: { orgId: 'org-1', role: { in: ['ADMIN', 'STAFF', 'MEMBER'] } },
      });
    });

    it('never sets a quantity on a flat plan', async () => {
      // Unlimited is $349 flat. A quantity of 37 is a $12,913 invoice.
      prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
      stripe.subscriptions.retrieve.mockResolvedValue(itemsOf(UNLIMITED_MONTHLY));

      await fire(upcoming('sub_unlimited'));

      expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
    });

    it('ignores a subscription that is not a co-op’s MaybeOS plan', async () => {
      // A member's dues to their co-op renew through this same event.
      prisma.organization.findFirst.mockResolvedValue(null);

      await fire(upcoming('sub_member_dues'));

      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('leaves a co-op with no billable members alone rather than billing zero', async () => {
      prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
      prisma.userOrg.count.mockResolvedValue(0);
      stripe.subscriptions.retrieve.mockResolvedValue(itemsOf(PLUS_MONTHLY));

      await fire(upcoming('sub_plus'));

      expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
    });

    it('does not write when the count has not changed', async () => {
      prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
      stripe.subscriptions.retrieve.mockResolvedValue(itemsOf(PLUS_MONTHLY, 37));

      await fire(upcoming('sub_plus'));

      expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
    });

    it('does not fail the webhook when Stripe refuses the update', async () => {
      // A failed quantity write must not make Stripe retry the whole event,
      // and must not throw inside the claim transaction.
      prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
      stripe.subscriptions.retrieve.mockResolvedValue(itemsOf(PLUS_MONTHLY));
      stripe.subscriptionItems.update.mockRejectedValue(new Error('nope'));

      await expect(fire(upcoming('sub_plus'))).resolves.toEqual({ received: true });
    });
  });

  /* ─── At signup ──────────────────────────────────────────── */

  /**
   * Found by watching a real subscription rather than by reading the code.
   * Stripe charges at checkout *before* MaybeOS can set the quantity, and the
   * pricing table creates the subscription at quantity 1 — MaybeItsFate paid
   * $3.65 for one member while having two. On the yearly price a 300-member
   * co-op would pay $3.65 for its whole first year instead of $1,095.
   */
  describe('at signup', () => {
    beforeEach(() => {
      stripe.subscriptions.retrieve.mockResolvedValue(itemsOf(PLUS_MONTHLY));
    });

    it('invoices the difference rather than waiting a whole period', async () => {
      await fire(completed());

      expect(stripe.subscriptionItems.update).toHaveBeenCalledWith('si_1', {
        quantity: 37,
        proration_behavior: 'always_invoice',
      });
    });

    it('puts the co-op on the plan it paid for', async () => {
      await fire(completed());

      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-1' },
          data: expect.objectContaining({ plan: 'PLUS', stripePlanSubscriptionId: 'sub_plus' }),
        }),
      );
    });

    it('does nothing without a client_reference_id — the only thing naming the co-op', async () => {
      // The production failure of 2026-08-20: a real payment MaybeOS could not
      // attribute. Nothing else in the flow carries the org id, so the whole
      // link depends on this one field arriving.
      await fire(completed({ client_reference_id: null }));

      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
    });
  });
});
