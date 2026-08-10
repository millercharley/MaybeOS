import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';

/**
 * The client handed to webhook handlers. Always the transaction-scoped client,
 * never `this.prisma` — a handler that writes outside the transaction would
 * leave its changes behind when the claim rolls back, which is the exact
 * split-brain the transaction exists to prevent.
 */
type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      this.logger.warn(
        'STRIPE_SECRET_KEY not configured – Stripe calls will fail (dev mode)',
      );
    }
    this.stripe = new Stripe(stripeKey || 'sk_test_placeholder');
  }

  // ──────────────────────────────────────────────────────────────
  // Checkout & Billing Portal
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a Stripe Checkout session for a membership subscription.
   * Returns the checkout session URL for client-side redirect.
   */
  async createCheckoutSession(
    orgId: string,
    userId: string,
    tierId: string,
    successUrl: string,
    cancelUrl: string,
    amountCents?: number,
  ): Promise<string> {
    // 1. Look up the tier
    const tier = await this.prisma.membershipTier.findUnique({
      where: { id: tierId },
    });

    if (!tier) {
      throw new NotFoundException('Membership tier not found');
    }

    // 2. Resolve what this member will actually be charged.
    const lineItem = tier.isPayWhatYouCan
      ? this.payWhatYouCanLineItem(tier, amountCents)
      : this.fixedPriceLineItem(tier, amountCents);

    // 3. Look up or create a Stripe Customer for the user
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { user: true },
    });

    if (!userOrg) {
      throw new NotFoundException('User is not a member of this organization');
    }

    let stripeCustomerId = userOrg.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        email: userOrg.user.email,
        name: userOrg.user.name ?? undefined,
        metadata: { orgId, userId },
      });

      stripeCustomerId = customer.id;

      await this.prisma.userOrg.update({
        where: { id: userOrg.id },
        data: { stripeCustomerId },
      });
    }

    // 4. Create the Checkout session
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [lineItem],
      metadata: { orgId, userId, tierId },
      subscription_data: {
        metadata: { orgId, userId, tierId },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return session.url;
  }

  /**
   * Stripe rejects any charge under 50 cents (USD). A tier whose minimum sits
   * below that would fail at the Stripe call with an opaque error, so catch it
   * here where we can say what actually went wrong.
   */
  private static readonly STRIPE_MINIMUM_CENTS = 50;

  /**
   * Fixed-price tier: charge the price the admin configured.
   *
   * A submitted amount is rejected rather than ignored. Silently discarding it
   * would let a member believe they had chosen what to pay while being billed
   * something else.
   */
  private fixedPriceLineItem(
    tier: { stripePriceIdMonthly: string | null },
    amountCents?: number,
  ): Stripe.Checkout.SessionCreateParams.LineItem {
    if (amountCents !== undefined) {
      throw new BadRequestException(
        'This tier has a fixed price; an amount cannot be chosen for it',
      );
    }
    if (!tier.stripePriceIdMonthly) {
      throw new NotFoundException(
        'Membership tier has no associated Stripe price',
      );
    }
    return { price: tier.stripePriceIdMonthly, quantity: 1 };
  }

  /**
   * Pay-what-you-can tier: charge the amount the member chose.
   *
   * The amount arrives from the browser, so it is validated here and never
   * trusted. Without this check a member could subscribe to any tier for a
   * cent. Stripe's `custom_unit_amount` would be the neater mechanism but it
   * only works for one-time prices, not recurring ones, so the chosen amount
   * is sent as an inline `price_data` against the tier's existing Product.
   */
  private payWhatYouCanLineItem(
    tier: {
      name: string;
      minPrice: number | null;
      stripeProductId: string | null;
      id: string;
      orgId: string;
    },
    amountCents?: number,
  ): Stripe.Checkout.SessionCreateParams.LineItem {
    if (amountCents === undefined) {
      throw new BadRequestException(
        'This tier is pay-what-you-can; choose an amount to continue',
      );
    }

    const floor = Math.max(
      tier.minPrice ?? 0,
      StripeService.STRIPE_MINIMUM_CENTS,
    );

    if (amountCents < floor) {
      throw new BadRequestException(
        `Amount must be at least ${(floor / 100).toFixed(2)} for this tier`,
      );
    }

    if (!tier.stripeProductId) {
      throw new NotFoundException(
        'Membership tier has no associated Stripe product',
      );
    }

    return {
      price_data: {
        currency: 'usd',
        product: tier.stripeProductId,
        unit_amount: amountCents,
        recurring: { interval: 'month' },
      },
      quantity: 1,
    };
  }

  /**
   * Create a Stripe Billing Portal session so a customer can manage
   * their subscription, payment methods, and invoices.
   */
  async createBillingPortalSession(
    stripeCustomerId: string,
    returnUrl: string,
  ): Promise<string> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });

    return session.url;
  }

  // ──────────────────────────────────────────────────────────────
  // Webhook Handling
  // ──────────────────────────────────────────────────────────────

  /**
   * Verify the Stripe webhook signature and process the event.
   * Returns { received: true } on success.
   */
  async handleWebhook(
    rawBody: Buffer,
    signature: string,
  ): Promise<{ received: true }> {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err.message}`);
      throw new BadRequestException('Webhook signature verification failed');
    }

    this.logger.log(`Processing webhook event: ${event.type} (${event.id})`);

    // Claim and process in a single transaction.
    //
    // The WebhookEvent row is both the idempotency record and the lock: its
    // primary key is the Stripe event id, so a concurrent redelivery either
    // blocks on the unique index and then fails with P2002, or — if this
    // transaction rolls back — proceeds cleanly. The previous implementation
    // did `findUnique` and then `create` as two separate statements, which two
    // simultaneous deliveries could both pass before either wrote.
    //
    // Rolling the dispatch into the same transaction also fixes the more
    // damaging bug: a throwing handler used to be logged, swallowed, and the
    // event still marked processed with a 200 response. Stripe treats that as
    // success and never retries, so a member could pay and never have their
    // membership activated, with nothing failing visibly on either side. Now
    // the claim rolls back with the work and the error propagates, so Stripe
    // retries on its own schedule.
    //
    // Requires a session-mode connection: Prisma interactive transactions do
    // not work over PgBouncer in transaction mode. See D-010 — DATABASE_URL is
    // deliberately the Supabase session pooler (5432), not 6543.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.webhookEvent.create({
          data: { id: event.id, source: 'stripe' },
        });

        await this.dispatchEvent(event, tx);
      });
    } catch (err) {
      if (this.isAlreadyProcessed(err)) {
        this.logger.log(`Event ${event.id} already processed, skipping`);
        return { received: true };
      }

      this.logger.error(
        `Error handling event ${event.type} (${event.id}): ${err.message}`,
        err.stack,
      );
      // Propagate so the endpoint answers non-2xx and Stripe retries.
      throw err;
    }

    return { received: true };
  }

  /** Prisma P2002 = unique constraint violation, i.e. another delivery won the race. */
  private isAlreadyProcessed(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    );
  }

  private async dispatchEvent(event: Stripe.Event, tx: PrismaTx): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(
          event.data.object as Stripe.Subscription,
          tx,
        );
        break;

      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
          tx,
        );
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
          tx,
        );
        break;

      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
          tx,
        );
        break;

      default:
        // Not an error: Stripe sends event types we haven't subscribed to or
        // don't care about. The claim still commits so we don't reprocess.
        this.logger.log(`Unhandled event type: ${event.type}`);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // Subscription Event Handlers
  // ──────────────────────────────────────────────────────────────

  private async handleSubscriptionCreated(
    subscription: Stripe.Subscription,
    tx: PrismaTx,
  ) {
    const { orgId, userId, tierId } = subscription.metadata;

    if (!orgId || !userId) {
      this.logger.warn(
        `Subscription ${subscription.id} missing metadata (orgId/userId)`,
      );
      return;
    }

    await tx.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      data: {
        stripeSubscriptionId: subscription.id,
        subscriptionStatus: 'ACTIVE',
        tierId: tierId || undefined,
      },
    });

    this.logger.log(
      `Subscription ${subscription.id} created for user ${userId} in org ${orgId}`,
    );
  }

  private async handleSubscriptionUpdated(
    subscription: Stripe.Subscription,
    tx: PrismaTx,
  ) {
    const statusMap: Record<string, string> = {
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      canceled: 'CANCELED',
      trialing: 'TRIALING',
    };

    const mappedStatus = statusMap[subscription.status];
    if (!mappedStatus) {
      this.logger.warn(
        `Unmapped subscription status: ${subscription.status}`,
      );
      return;
    }

    const userOrg = await tx.userOrg.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!userOrg) {
      this.logger.warn(
        `No UserOrg found for subscription ${subscription.id}`,
      );
      return;
    }

    await tx.userOrg.update({
      where: { id: userOrg.id },
      data: { subscriptionStatus: mappedStatus as any },
    });

    this.logger.log(
      `Subscription ${subscription.id} updated to status ${mappedStatus}`,
    );
  }

  private async handleSubscriptionDeleted(
    subscription: Stripe.Subscription,
    tx: PrismaTx,
  ) {
    const userOrg = await tx.userOrg.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!userOrg) {
      this.logger.warn(
        `No UserOrg found for subscription ${subscription.id}`,
      );
      return;
    }

    await tx.userOrg.update({
      where: { id: userOrg.id },
      data: { subscriptionStatus: 'CANCELED' },
    });

    this.logger.log(`Subscription ${subscription.id} canceled`);
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice, tx: PrismaTx) {
    const subscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    if (!subscriptionId) {
      this.logger.warn('Invoice payment failed but no subscription ID found');
      return;
    }

    const userOrg = await tx.userOrg.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      include: { user: true, org: true },
    });

    if (!userOrg) {
      this.logger.warn(
        `No UserOrg found for subscription ${subscriptionId}`,
      );
      return;
    }

    await tx.userOrg.update({
      where: { id: userOrg.id },
      data: { subscriptionStatus: 'PAST_DUE' },
    });

    // Queue a dunning email via the email module.
    // NOTE: To avoid a circular dependency, the controller or an event emitter
    // should handle email dispatch. For MVP we log the intent here.
    this.logger.warn(
      `Payment failed for user ${userOrg.userId} in org ${userOrg.orgId} – dunning email should be queued`,
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Subscription Sync
  // ──────────────────────────────────────────────────────────────

  /**
   * Fetch the latest subscription state from Stripe and update the local DB.
   * Useful for reconciliation or manual admin triggers.
   */
  async syncSubscriptionStatus(stripeSubscriptionId: string) {
    const subscription = await this.stripe.subscriptions.retrieve(
      stripeSubscriptionId,
    );

    const statusMap: Record<string, string> = {
      active: 'ACTIVE',
      past_due: 'PAST_DUE',
      canceled: 'CANCELED',
      trialing: 'TRIALING',
      incomplete: 'PAST_DUE',
      incomplete_expired: 'CANCELED',
      unpaid: 'PAST_DUE',
    };

    const mappedStatus = statusMap[subscription.status] ?? 'NONE';

    const userOrg = await this.prisma.userOrg.findFirst({
      where: { stripeSubscriptionId },
    });

    if (!userOrg) {
      throw new NotFoundException(
        `No membership found for subscription ${stripeSubscriptionId}`,
      );
    }

    await this.prisma.userOrg.update({
      where: { id: userOrg.id },
      data: { subscriptionStatus: mappedStatus as any },
    });

    this.logger.log(
      `Synced subscription ${stripeSubscriptionId} -> ${mappedStatus}`,
    );

    return { subscriptionId: stripeSubscriptionId, status: mappedStatus };
  }

  // ──────────────────────────────────────────────────────────────
  // Stripe Product / Price Creation
  // ──────────────────────────────────────────────────────────────

  /**
   * Create a Stripe Product and a recurring monthly Price for a membership tier.
   * Returns the Stripe price ID so it can be stored on the tier.
   */
  async createStripePricesForTier(tier: {
    id: string;
    name: string;
    description?: string;
    priceMonthly: number;
    orgId: string;
  }): Promise<string> {
    const product = await this.stripe.products.create({
      name: tier.name,
      description: tier.description ?? undefined,
      metadata: { tierId: tier.id, orgId: tier.orgId },
    });

    const price = await this.stripe.prices.create({
      product: product.id,
      unit_amount: tier.priceMonthly, // already in cents
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { tierId: tier.id, orgId: tier.orgId },
    });

    // Store the product id too: pay-what-you-can checkouts build an inline
    // price against it, and without it PWYC has nothing to attach to.
    await this.prisma.membershipTier.update({
      where: { id: tier.id },
      data: { stripeProductId: product.id },
    });

    this.logger.log(
      `Created Stripe product ${product.id} and price ${price.id} for tier ${tier.id}`,
    );

    return price.id;
  }
}
