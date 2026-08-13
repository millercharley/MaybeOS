import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { ConnectService } from './connect.service';

/**
 * The client handed to webhook handlers. Always the transaction-scoped client,
 * never `this.prisma` — a handler that writes outside the transaction would
 * leave its changes behind when the claim rolls back, which is the exact
 * split-brain the transaction exists to prevent.
 */
type PrismaTx = Prisma.TransactionClient;

/**
 * Statuses that mean "this member has a live subscription Stripe is managing".
 * PAST_DUE counts: the subscription still exists and switching tiers or fixing
 * a card is exactly what a past-due member needs to do — through the portal,
 * not by starting a second subscription. CANCELED and NONE do not count, so
 * those members can check out again normally.
 */
const ACTIVE_SUBSCRIPTION_STATUSES = ['ACTIVE', 'TRIALING', 'PAST_DUE'];

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    // Ticket sales land on the co-op's connected account and are recorded by
    // ConnectService; this service still owns the single webhook endpoint that
    // Stripe posts to, so it dispatches to it (D-013 keeps the two billing
    // systems apart, not the one signature-verified entry point).
    private readonly connectService: ConnectService,
  ) {
    const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      this.logger.warn(
        'STRIPE_SECRET_KEY not configured – Stripe calls will fail (dev mode)',
      );
    }
    this.stripe = new Stripe(
      stripeKey || 'sk_test_placeholder',
    // Pinned rather than left to the account default (Stripe's own guidance:
    // "Always specify the API version you're integrating against"). Without
    // this, production billing rides whatever the Stripe account's default
    // happens to be, so a change made in the Dashboard — or by Stripe — alters
    // request and response shapes with no deploy and no diff to point at.
    { apiVersion: '2026-07-29.dahlia' },
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
    amountCents?: number,
  ): Promise<string> {
    // 1. Look up the tier — scoped to the org being joined (SEC-04). This
    // method already received `orgId` and resolved the tier without it, so a
    // member could open a checkout session against *another* co-op's tier:
    // its price, its Stripe product, charged under this org's join flow.
    const tier = await this.prisma.membershipTier.findFirst({
      where: { id: tierId, orgId },
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

    // Checkout is for *starting* dues, never for changing them. A member who
    // already has a live subscription must go through the Billing Portal, so
    // Stripe handles the switch as a proration on the existing subscription.
    //
    // This is enforced here, not just hidden in the UI: without it a second
    // checkout silently creates a *second* subscription and the member is
    // charged twice a month. Observed during sandbox testing — one member
    // ended up with concurrent $12 and $18 subscriptions.
    if (
      userOrg.stripeSubscriptionId &&
      ACTIVE_SUBSCRIPTION_STATUSES.includes(userOrg.subscriptionStatus)
    ) {
      throw new ConflictException(
        'You already have an active membership. Use the billing portal to change your tier or payment method.',
      );
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
   * Change what a tier costs.
   *
   * Stripe Prices are **immutable** — there is no way to edit an amount. The
   * only correct move is to create a replacement Price on the same Product,
   * stop offering the old one, and repoint the tier. Skipping this is how an
   * admin edits "Community" from $15 to $20, sees $20 everywhere in MaybeOS,
   * and has Stripe keep charging $15 forever.
   *
   * Returns the new price id. Existing subscribers are only touched when
   * `applyToExisting` is set — see UpdateTierDto for why that is a deliberate
   * choice rather than a default.
   */
  async repriceTier(
    tier: {
      id: string;
      name: string;
      stripeProductId: string | null;
      stripePriceIdMonthly: string | null;
    },
    newPriceCents: number,
    applyToExisting: boolean,
  ): Promise<{ priceId: string; migrated: number }> {
    if (!tier.stripeProductId) {
      throw new NotFoundException(
        'Tier has no Stripe product yet, so its price cannot be changed. Provision it first.',
      );
    }

    const price = await this.stripe.prices.create({
      product: tier.stripeProductId,
      unit_amount: newPriceCents,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { tierId: tier.id },
    });

    // Deactivate rather than delete: Stripe keeps historical Prices so past
    // invoices still resolve, and any subscription grandfathered onto the old
    // Price keeps billing correctly. Deactivating only stops it being offered
    // to anyone new.
    if (tier.stripePriceIdMonthly) {
      try {
        await this.stripe.prices.update(tier.stripePriceIdMonthly, { active: false });
      } catch (err) {
        // Not fatal — the new Price is already live and the tier will point at
        // it. A stale active Price is untidy, not harmful.
        this.logger.warn(
          `Could not archive old price ${tier.stripePriceIdMonthly} for tier ${tier.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    let migrated = 0;
    if (applyToExisting) {
      migrated = await this.migrateSubscribersToPrice(tier.id, price.id);
    }

    this.logger.log(
      `Repriced tier ${tier.id} (${tier.name}) to ${newPriceCents}c as ${price.id}; ` +
        `${applyToExisting ? `${migrated} subscriber(s) moved` : 'existing subscribers grandfathered'}`,
    );

    return { priceId: price.id, migrated };
  }

  /**
   * Point every live subscription on a tier at a new Price, effective at each
   * member's next renewal.
   *
   * `proration_behavior: 'none'` is the important part: without it Stripe
   * issues an immediate prorated charge or credit, so an admin correcting a
   * price would surprise every member with a same-day transaction.
   */
  private async migrateSubscribersToPrice(
    tierId: string,
    priceId: string,
  ): Promise<number> {
    const subscribers = await this.prisma.userOrg.findMany({
      where: {
        tierId,
        stripeSubscriptionId: { not: null },
        subscriptionStatus: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      },
      select: { id: true, stripeSubscriptionId: true },
    });

    let migrated = 0;
    for (const sub of subscribers) {
      try {
        const existing = await this.stripe.subscriptions.retrieve(
          sub.stripeSubscriptionId as string,
        );
        const item = existing.items.data[0];
        if (!item) continue;

        await this.stripe.subscriptions.update(existing.id, {
          items: [{ id: item.id, price: priceId }],
          proration_behavior: 'none',
        });
        migrated += 1;
      } catch (err) {
        // One member's failure must not abort the rest. They stay on the old
        // price, which still bills correctly.
        this.logger.warn(
          `Could not move subscription ${sub.stripeSubscriptionId} to ${priceId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return migrated;
  }

  /**
   * Ensure this org has a Billing Portal configuration that permits switching
   * between its own tiers, and return its id.
   *
   * This is load-bearing. Stripe's default portal lets a customer update their
   * card and cancel, but **not change plan** — plan switching only appears when
   * the configuration is given an explicit product list. Since members are now
   * required to use the portal to change tiers, a default portal would leave
   * them with no way to do it at all.
   *
   * The configuration is per-org because the product list is the org's own
   * tiers; one shared configuration would offer every co-op's tiers to every
   * member. Cached on the Organization so this is one API call, not one per
   * portal visit.
   */
  private async ensurePortalConfiguration(orgId: string): Promise<string | undefined> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, stripePortalConfigId: true },
    });

    if (org?.stripePortalConfigId) return org.stripePortalConfigId;

    const tiers = await this.prisma.membershipTier.findMany({
      where: { orgId, isActive: true, stripeProductId: { not: null } },
      select: { stripeProductId: true, stripePriceIdMonthly: true, isPayWhatYouCan: true },
    });

    // Pay-what-you-can tiers are deliberately excluded: their price is created
    // per member at checkout, so there is no shared Price for the portal to
    // offer. A member switching *to* PWYC has to cancel and check out again.
    const products = tiers
      .filter((t) => !t.isPayWhatYouCan && t.stripePriceIdMonthly)
      .map((t) => ({
        product: t.stripeProductId as string,
        prices: [t.stripePriceIdMonthly as string],
      }));

    if (products.length === 0) {
      // Nothing switchable. Fall back to the account default so the member can
      // still update a card or cancel.
      this.logger.warn(
        `Org ${orgId} has no fixed-price tiers with Stripe prices; the billing portal will not offer plan switching.`,
      );
      return undefined;
    }

    const configuration = await this.stripe.billingPortal.configurations.create({
      business_profile: { headline: `${org?.name ?? 'Your co-op'} — manage your membership` },
      features: {
        customer_update: { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price'],
          proration_behavior: 'create_prorations',
          products,
        },
      },
    });

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { stripePortalConfigId: configuration.id },
    });

    this.logger.log(
      `Created billing portal configuration ${configuration.id} for org ${orgId} with ${products.length} switchable tier(s)`,
    );

    return configuration.id;
  }

  /**
   * Create a Stripe Billing Portal session so a customer can manage
   * their subscription, payment methods, and invoices.
   */
  async createBillingPortalSession(
    stripeCustomerId: string,
    returnUrl: string,
    orgId?: string,
  ): Promise<string> {
    const configuration = orgId
      ? await this.ensurePortalConfiguration(orgId)
      : undefined;

    const session = await this.stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
      ...(configuration ? { configuration } : {}),
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

      case 'checkout.session.completed': {
        // Ticket sales arrive here, from the co-op's connected account rather
        // than MaybeOS's own (D-013). Membership checkout uses subscription
        // events above and never reaches this branch — `recordTicketFromSession`
        // ignores anything without `kind: event_ticket` in its metadata.
        //
        // Recorded on the webhook, not the success redirect: a buyer who
        // closes the tab has still paid, and a seat issued on a redirect is a
        // seat sold on the buyer's browser behaving.
        await this.connectService.recordTicketFromSession(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      }

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
    /**
     * `invoice.subscription` was removed between acacia and dahlia; the
     * subscription now hangs off `invoice.parent.subscription_details`.
     *
     * This is the one breaking change in the SDK upgrade that reached live
     * code, and it would have failed quietly rather than loudly: on dahlia the
     * old path is simply `undefined`, so every failed dues payment would have
     * hit the "no subscription ID found" branch below and returned. Nobody
     * would ever be marked PAST_DUE, no dunning would follow, and the only
     * symptom would be members keeping access they had stopped paying for.
     */
    const parentSubscription = invoice.parent?.subscription_details?.subscription;
    const subscriptionId =
      typeof parentSubscription === 'string'
        ? parentSubscription
        : parentSubscription?.id;

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
