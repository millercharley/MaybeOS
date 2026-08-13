import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeService } from '../stripe.service';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * A failed dues payment marks the membership PAST_DUE.
 *
 * This had no test, and the SDK upgrade from acacia to dahlia removed the
 * field it depended on: `invoice.subscription` became
 * `invoice.parent.subscription_details.subscription`.
 *
 * The dangerous part is that it fails *quietly*. On dahlia the old path reads
 * `undefined`, so the handler would take its "no subscription ID found" branch
 * and return successfully. Stripe gets a 200, nothing retries, nothing errors,
 * and no member is ever marked past due — the only symptom is people keeping
 * access to a co-op they have stopped paying for, discovered whenever somebody
 * next reconciles by hand.
 *
 * So this asserts the payload shape Stripe actually sends today, not the
 * shape the code used to expect.
 */
describe('StripeService — invoice.payment_failed', () => {
  let service: StripeService;
  let tx: { userOrg: { findFirst: jest.Mock; update: jest.Mock } };

  const invoiceWith = (subscription: unknown) =>
    ({
      id: 'in_123',
      parent: { subscription_details: { subscription } },
    }) as unknown as Stripe.Invoice;

  beforeEach(async () => {
    tx = {
      userOrg: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          stripeSubscriptionId: 'sub_123',
          user: { email: 'member@example.com', name: 'Alex' },
          org: { name: 'Sunrise', slug: 'sunrise' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: ConnectService, useValue: { recordTicketFromSession: jest.fn() } },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
  });

  /** Drives the private handler the way the webhook dispatcher does. */
  const handle = (invoice: Stripe.Invoice) =>
    (
      service as unknown as {
        handleInvoicePaymentFailed: (i: Stripe.Invoice, t: unknown) => Promise<void>;
      }
    ).handleInvoicePaymentFailed(invoice, tx);

  it('reads the subscription from invoice.parent, where dahlia puts it', async () => {
    await handle(invoiceWith('sub_123'));

    expect(tx.userOrg.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { stripeSubscriptionId: 'sub_123' } }),
    );
    expect(tx.userOrg.update.mock.calls[0][0].data.subscriptionStatus).toBe('PAST_DUE');
  });

  it('handles the subscription arriving expanded rather than as an id', async () => {
    await handle(invoiceWith({ id: 'sub_123' }));

    expect(tx.userOrg.update.mock.calls[0][0].data.subscriptionStatus).toBe('PAST_DUE');
  });

  it('does nothing when there is genuinely no subscription', async () => {
    // A one-off invoice with no subscription is not a membership failure.
    await handle({ id: 'in_123', parent: null } as unknown as Stripe.Invoice);

    expect(tx.userOrg.findFirst).not.toHaveBeenCalled();
    expect(tx.userOrg.update).not.toHaveBeenCalled();
  });

  it('does not read the removed top-level field', async () => {
    // The regression this file exists for: an invoice carrying only the old
    // acacia shape must NOT silently succeed, because that is precisely how
    // the bug hid.
    await handle({ id: 'in_123', subscription: 'sub_123' } as unknown as Stripe.Invoice);

    expect(tx.userOrg.update).not.toHaveBeenCalled();
  });
});
