import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../stripe.service';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * The renewal snapshot actually fires (PLT-03).
 *
 * The quantity logic was tested in isolation and the allowlist was tested in
 * isolation, and neither proves the webhook reaches them. That gap is exactly
 * how `TouchpointAsk` shipped with zero importers and IMP-15 read as done
 * while asking nobody anything — a correct handler nothing calls fails
 * silently, and here it would fail as an invoice for the wrong amount.
 */
describe('StripeService — the renewal snapshot', () => {
  let service: StripeService;
  let prisma: any;
  let stripe: any;

  const upcoming = (subscriptionId: string) => ({
    id: `evt_${subscriptionId}`,
    type: 'invoice.upcoming',
    data: { object: { subscription: subscriptionId } },
  });

  beforeEach(async () => {
    prisma = {
      webhookEvent: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      organization: { findFirst: jest.fn(), update: jest.fn() },
      userOrg: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(37) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'whsec_test' } },
        { provide: ConnectService, useValue: { recordTicketFromSession: jest.fn(), confirmBookingFromSession: jest.fn() } },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    stripe = (service as any).stripe;
    stripe.webhooks = { constructEvent: jest.fn() };
    stripe.subscriptions = { retrieve: jest.fn() };
    stripe.subscriptionItems = { update: jest.fn().mockResolvedValue({}) };
  });

  const fire = async (subscriptionId: string) => {
    stripe.webhooks.constructEvent.mockReturnValue(upcoming(subscriptionId));
    return service.handleWebhook(Buffer.from('body'), 'sig');
  };

  it('sets the quantity to the co-op’s member count on a per-member plan', async () => {
    prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
    stripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_1U6M1VD14bhghVE2lprg1qo0' } }] },
    });

    await fire('sub_plus');

    expect(stripe.subscriptionItems.update).toHaveBeenCalledWith('si_1', {
      quantity: 37,
      // No proration: the point of a snapshot is one predictable bill.
      proration_behavior: 'none',
    });
  });

  it('counts organisers, staff and members — never guests', async () => {
    prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
    stripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_1U6M1VD14bhghVE2lprg1qo0' } }] },
    });

    await fire('sub_plus');

    expect(prisma.userOrg.count).toHaveBeenCalledWith({
      where: { orgId: 'org-1', role: { in: ['ADMIN', 'STAFF', 'MEMBER'] } },
    });
  });

  it('never sets a quantity on a flat plan', async () => {
    // Unlimited is $349 flat. A quantity of 37 here is a $12,913 invoice.
    prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
    stripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_1U6LvpD14bhghVE2Grl0L9DI' } }] },
    });

    await fire('sub_unlimited');

    expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
  });

  it('ignores a subscription that is not a co-op’s MaybeOS plan', async () => {
    // A member's dues to their co-op renew through this same event.
    prisma.organization.findFirst.mockResolvedValue(null);

    await fire('sub_member_dues');

    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
  });

  it('leaves a co-op with no billable members alone rather than billing zero', async () => {
    prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
    prisma.userOrg.count.mockResolvedValue(0);
    stripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_1U6M1VD14bhghVE2lprg1qo0' } }] },
    });

    await fire('sub_plus');

    expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
  });

  it('does not write when the count has not changed', async () => {
    prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
    stripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 37, price: { id: 'price_1U6M1VD14bhghVE2lprg1qo0' } }] },
    });

    await fire('sub_plus');

    expect(stripe.subscriptionItems.update).not.toHaveBeenCalled();
  });

  it('does not fail the webhook when Stripe refuses the update', async () => {
    // A failed quantity write must not make Stripe retry the whole event and
    // must not throw inside the claim transaction.
    prisma.organization.findFirst.mockResolvedValue({ id: 'org-1' });
    stripe.subscriptions.retrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_1U6M1VD14bhghVE2lprg1qo0' } }] },
    });
    stripe.subscriptionItems.update.mockRejectedValue(new Error('nope'));

    await expect(fire('sub_plus')).resolves.toEqual({ received: true });
  });
});
