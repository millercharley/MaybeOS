import { ConfigService } from '@nestjs/config';
import { PublicPricingService } from '../public-pricing.service';
import { ADVERTISED_PRICE_IDS } from '../maybeos-plans';

/**
 * The prices on the landing page (WEB-02), read from Stripe.
 *
 * What matters: the figures are Stripe's own amounts; a price that is no
 * longer sellable is not advertised; Stripe is not asked on every page view;
 * and an outage keeps showing the last good figures rather than none.
 */
describe('PublicPricingService', () => {
  const LIVE: Record<string, { unit_amount: number; interval: 'month' | 'year' }> = {
    [ADVERTISED_PRICE_IDS.FREE.month]: { unit_amount: 0, interval: 'month' },
    [ADVERTISED_PRICE_IDS.FREE.year]: { unit_amount: 0, interval: 'year' },
    [ADVERTISED_PRICE_IDS.PLUS.month]: { unit_amount: 50, interval: 'month' },
    [ADVERTISED_PRICE_IDS.PLUS.year]: { unit_amount: 365, interval: 'year' },
    [ADVERTISED_PRICE_IDS.UNLIMITED.month]: { unit_amount: 34900, interval: 'month' },
    [ADVERTISED_PRICE_IDS.UNLIMITED.year]: { unit_amount: 358800, interval: 'year' },
  };

  let retrieve: jest.Mock;
  let service: PublicPricingService;

  const price = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    active: true,
    currency: 'usd',
    unit_amount: LIVE[id].unit_amount,
    recurring: { interval: LIVE[id].interval },
    ...over,
  });

  beforeEach(() => {
    service = new PublicPricingService({ get: () => 'sk_test_x' } as unknown as ConfigService);
    retrieve = jest.fn((id: string) => Promise.resolve(price(id)));
    (service as unknown as { stripe: unknown }).stripe = { prices: { retrieve } };
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns Stripe’s amounts with the fees billing charges', async () => {
    expect(await service.pricing()).toEqual({
      currency: 'usd',
      writtenReportCents: 5000,
      plans: [
        { plan: 'FREE', monthlyCents: 0, yearlyCents: 0, perMember: false, transactionFeeCents: 100, duesFeeCents: 200, memberLimit: 100 },
        { plan: 'PLUS', monthlyCents: 50, yearlyCents: 365, perMember: true, transactionFeeCents: 30, duesFeeCents: 0, memberLimit: null },
        { plan: 'UNLIMITED', monthlyCents: 34900, yearlyCents: 358800, perMember: false, transactionFeeCents: 10, duesFeeCents: 0, memberLimit: null },
      ],
    });
  });

  it('asks Stripe once an hour, not on every page view', async () => {
    const t = 1_000_000;
    await service.pricing(t);
    await service.pricing(t + 30 * 60 * 1000);
    expect(retrieve).toHaveBeenCalledTimes(6);
    await service.pricing(t + 61 * 60 * 1000);
    expect(retrieve).toHaveBeenCalledTimes(12);
  });

  it('does not advertise a price that was archived or changed interval', async () => {
    retrieve.mockImplementation((id: string) =>
      Promise.resolve(
        id === ADVERTISED_PRICE_IDS.UNLIMITED.year
          ? price(id, { active: false })
          : id === ADVERTISED_PRICE_IDS.PLUS.month
            ? price(id, { recurring: { interval: 'year' } })
            : price(id),
      ),
    );
    const { plans } = await service.pricing();
    expect(plans[2].yearlyCents).toBeNull();
    expect(plans[1].monthlyCents).toBeNull();
    expect(plans[0].monthlyCents).toBe(0);
  });

  it('keeps showing the last good figures when Stripe is down', async () => {
    const t = 2_000_000;
    await service.pricing(t);
    retrieve.mockRejectedValue(new Error('Stripe is down'));
    const later = await service.pricing(t + 2 * 60 * 60 * 1000);
    expect(later.plans[1].monthlyCents).toBe(50);
  });

  it('shows no figures, rather than guesses, when Stripe has never answered', async () => {
    retrieve.mockRejectedValue(new Error('Stripe is down'));
    const { plans } = await service.pricing();
    expect(plans.every((p) => p.monthlyCents === null && p.yearlyCents === null)).toBe(true);
    expect(plans[0].transactionFeeCents).toBe(100);
  });
});
