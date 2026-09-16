import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../stripe.service';
import { ADVERTISED_PRICE_IDS } from '../maybeos-plans';

/**
 * Paying for a MaybeOS plan from the landing page's buttons (PAY-09).
 *
 * It must create the same subscription the Settings pricing table does, so the
 * existing webhook sets the plan: the advertised price, on MaybeOS's own
 * account, carrying the org as `client_reference_id`.
 */
describe('plan checkout', () => {
  let service: StripeService;
  let create: jest.Mock;
  let org: Record<string, unknown>;
  let count: jest.Mock;

  beforeEach(() => {
    org = { slug: 'sunrise', planStatus: null, billingWaived: false, stripePlanSubscriptionId: null, stripePlanCustomerId: null };
    count = jest.fn().mockResolvedValue(42);
    const prisma = {
      organization: { findUnique: jest.fn(() => Promise.resolve(org)) },
      userOrg: { count },
    };
    service = new StripeService(
      { get: (k: string) => ({ STRIPE_SECRET_KEY: 'sk_test_x', WEB_URL: 'https://maybeos.org' })[k] } as unknown as ConfigService,
      prisma as never,
      {} as never,
    );
    create = jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    (service as unknown as { stripe: unknown }).stripe = { checkout: { sessions: { create } } };
  });

  it('bills Plus per member, at the co-op’s current member count, on MaybeOS’s account', async () => {
    expect(await service.createPlanCheckout('org-1', 'admin@sunrise.coop', 'PLUS', 'year')).toBe('https://checkout.stripe.com/x');
    const [params, options] = create.mock.calls[0];
    expect(options).toBeUndefined();
    expect(params).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: ADVERTISED_PRICE_IDS.PLUS.year, quantity: 42 }],
      client_reference_id: 'org-1',
      customer_email: 'admin@sunrise.coop',
      success_url: 'https://maybeos.org/admin/sunrise/settings?subscribed=1',
    });
    expect(count).toHaveBeenCalledWith({ where: { orgId: 'org-1', role: { in: ['ADMIN', 'STAFF', 'MEMBER'] } } });
  });

  it('charges tax the way the pricing table in Settings does', () => {
    // Stripe Tax is active on the account, so a plan bought from the landing
    // page must not be cheaper than the same plan bought in Settings.
    return service.createPlanCheckout('org-1', 'a@b.co', 'PLUS', 'month').then(() => {
      expect(create.mock.calls[0][0]).toMatchObject({
        automatic_tax: { enabled: true },
        billing_address_collection: 'required',
      });
    });
  });

  it('bills Unlimited at a quantity of one, whatever the member count', async () => {
    await service.createPlanCheckout('org-1', 'a@b.co', 'UNLIMITED', 'month');
    expect(create.mock.calls[0][0].line_items).toEqual([{ price: ADVERTISED_PRICE_IDS.UNLIMITED.month, quantity: 1 }]);
    expect(count).not.toHaveBeenCalled();
  });

  it('refuses a second plan while one is active', async () => {
    org.stripePlanSubscriptionId = 'sub_plan';
    org.planStatus = 'active';
    await expect(service.createPlanCheckout('org-1', 'a@b.co', 'PLUS', 'month')).rejects.toThrow(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses when MaybeOS is free for the co-op', async () => {
    org.billingWaived = true;
    await expect(service.createPlanCheckout('org-1', 'a@b.co', 'PLUS', 'month')).rejects.toThrow(/nothing to pay/);
  });

  it('reuses the co-op’s existing MaybeOS customer', async () => {
    org.stripePlanCustomerId = 'cus_plan';
    await service.createPlanCheckout('org-1', 'a@b.co', 'PLUS', 'month');
    expect(create.mock.calls[0][0]).toMatchObject({
      customer: 'cus_plan',
      // Without this, automatic tax has no address to work from.
      customer_update: { address: 'auto', name: 'auto' },
    });
    expect(create.mock.calls[0][0]).not.toHaveProperty('customer_email');
  });
});
