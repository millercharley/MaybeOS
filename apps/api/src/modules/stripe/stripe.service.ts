import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY'),
      { apiVersion: '2024-04-10' },
    );
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
  ): Promise<string> {
    // 1. Look up tier to get the Stripe price ID
    const tier = await this.prisma.membershipTier.findUnique({
      where: { id: tierId },
    });

    if (!tier || !tier.stripePriceIdMonthly) {
      throw new NotFoundException(
        'Membership tier not found or has no associated Stripe price',
      );
    }

    // 2. Look up or create a Stripe Customer for the user
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

    // 3. Create the Checkout session
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        {
          price: tier.stripePriceIdMonthly,
          quantity: 1,
        },
      ],
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

    // Database-backed idempotency check
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { id: event.id },
    });
    if (existing) {
      this.logger.log(`Event ${event.id} already processed, skipping`);
      return { received: true };
    }

    this.logger.log(`Processing webhook event: ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(
            event.data.object as Stripe.Subscription,
          );
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(
            event.data.object as Stripe.Subscription,
          );
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(
            event.data.object as Stripe.Subscription,
          );
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(
            event.data.object as Stripe.Invoice,
          );
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }
    } catch (err) {
      this.logger.error(
        `Error handling event ${event.type}: ${err.message}`,
        err.stack,
      );
      // We still mark it as processed to avoid retry loops for known-bad events.
      // In production, you may want more nuanced retry logic.
    }

    await this.prisma.webhookEvent.create({
      data: { id: event.id, source: 'stripe' },
    });

    return { received: true };
  }

  // ──────────────────────────────────────────────────────────────
  // Subscription Event Handlers
  // ──────────────────────────────────────────────────────────────

  private async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    const { orgId, userId, tierId } = subscription.metadata;

    if (!orgId || !userId) {
      this.logger.warn(
        `Subscription ${subscription.id} missing metadata (orgId/userId)`,
      );
      return;
    }

    await this.prisma.userOrg.update({
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

  private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
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

    const userOrg = await this.prisma.userOrg.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!userOrg) {
      this.logger.warn(
        `No UserOrg found for subscription ${subscription.id}`,
      );
      return;
    }

    await this.prisma.userOrg.update({
      where: { id: userOrg.id },
      data: { subscriptionStatus: mappedStatus as any },
    });

    this.logger.log(
      `Subscription ${subscription.id} updated to status ${mappedStatus}`,
    );
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const userOrg = await this.prisma.userOrg.findFirst({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!userOrg) {
      this.logger.warn(
        `No UserOrg found for subscription ${subscription.id}`,
      );
      return;
    }

    await this.prisma.userOrg.update({
      where: { id: userOrg.id },
      data: { subscriptionStatus: 'CANCELED' },
    });

    this.logger.log(`Subscription ${subscription.id} canceled`);
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    const subscriptionId =
      typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;

    if (!subscriptionId) {
      this.logger.warn('Invoice payment failed but no subscription ID found');
      return;
    }

    const userOrg = await this.prisma.userOrg.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      include: { user: true, org: true },
    });

    if (!userOrg) {
      this.logger.warn(
        `No UserOrg found for subscription ${subscriptionId}`,
      );
      return;
    }

    await this.prisma.userOrg.update({
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

    this.logger.log(
      `Created Stripe product ${product.id} and price ${price.id} for tier ${tier.id}`,
    );

    return price.id;
  }
}
