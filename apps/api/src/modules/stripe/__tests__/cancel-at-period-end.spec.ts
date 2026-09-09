import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../stripe.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../connect.service';

/**
 * A membership that is ending says so (PLT-06).
 *
 * Charley cancelled a real $4 subscription through the Billing Portal on
 * 2026-09-09. Everything worked and nothing changed on screen: Stripe's portal
 * cancels **at period end**, so the webhook arrives with `status: active` and
 * `cancel_at_period_end: true`. The handler mapped `active → ACTIVE`, which is
 * right — the member paid for the month — and the member's Billing page went
 * on telling them "Active — your dues are paid and up to date".
 *
 * Every status mapping in the code was correct, which is why only cancelling
 * something real could have found it.
 */
describe('a subscription set to end', () => {
  let service: StripeService;
  let prisma: any;

  const PERIOD_END = 1_791_331_200; // 2026-10-09T00:00:00Z

  /** What Stripe actually sends on a portal cancellation. */
  const subscription = (over: Record<string, unknown> = {}) =>
    ({
      id: 'sub_test',
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: PERIOD_END,
      // `current_period_end` lives on the *item* in this API version, not on
      // the subscription — the same drift that moved `invoice.subscription`.
      items: { data: [{ current_period_end: PERIOD_END }] },
      metadata: {},
      ...over,
    }) as never;

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findFirst: jest.fn().mockResolvedValue({ id: 'uo-1', orgId: 'org-1' }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      organization: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
        { provide: ConnectService, useValue: { recordTicketFromSession: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(StripeService);
  });

  const written = () => prisma.userOrg.update.mock.calls[0][0].data;
  const updated = (sub: unknown) =>
    (service as never as { handleSubscriptionUpdated: Function }).handleSubscriptionUpdated(
      sub,
      prisma,
    );
  const deleted = (sub: unknown) =>
    (service as never as { handleSubscriptionDeleted: Function }).handleSubscriptionDeleted(
      sub,
      prisma,
    );

  it('records that it is ending', async () => {
    await updated(subscription());

    expect(written().cancelAtPeriodEnd).toBe(true);
  });

  it('keeps the status ACTIVE, because the member paid for this month', async () => {
    // The point worth not "fixing": they keep access until the period ends.
    await updated(subscription());

    expect(written().subscriptionStatus).toBe('ACTIVE');
  });

  it('reads the end date off the subscription item, not the subscription', async () => {
    // `current_period_end` moved onto the item. Reading it from the old place
    // yields undefined, and the member is told their membership ends on
    // nothing in particular.
    await updated(subscription());

    expect(written().currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
  });

  it('falls back to cancel_at when there is no item', async () => {
    await updated(subscription({ items: { data: [] } }));

    expect(written().currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
  });

  it('shows no date rather than failing when Stripe sends neither', async () => {
    // A mapper, not a validator: a missing date must not fail a webhook and
    // leave the membership unrecorded.
    await updated(subscription({ items: { data: [] }, cancel_at: null }));

    expect(written().currentPeriodEnd).toBeNull();
    expect(written().cancelAtPeriodEnd).toBe(true);
  });

  it('marks a member who is staying as not ending', async () => {
    await updated(subscription({ cancel_at_period_end: false, cancel_at: null }));

    expect(written().cancelAtPeriodEnd).toBe(false);
    expect(written().currentPeriodEnd).toEqual(new Date(PERIOD_END * 1000));
  });

  it('stops saying "ending" once it has ended', async () => {
    // The period-end event. Leaving the flag true would keep announcing a
    // future end date for a membership that is already over.
    await deleted(subscription({ status: 'canceled' }));

    expect(written().subscriptionStatus).toBe('CANCELED');
    expect(written().cancelAtPeriodEnd).toBe(false);
  });
});
