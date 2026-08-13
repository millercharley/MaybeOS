import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../config/prisma.service';
import { priceTicket } from './ticket-pricing';

/**
 * Stripe Connect: paying co-ops directly, and taking MaybeOS's cut (D-013).
 *
 * D-013 is explicit that this is forced rather than chosen: "taking a cut of
 * another party's charge *is* `application_fee_amount`, which only exists
 * under Connect. There is no version of this that works by routing other
 * co-ops' dues through MaybeOS's own Stripe account — that is money
 * transmission, not billing."
 *
 * So a ticket charge is created **on the co-op's connected account**, with
 * MaybeOS's per-transaction fee as the application fee. The co-op is paid by
 * Stripe on its own schedule; MaybeOS never holds the money.
 *
 * Deliberately separate from `StripeService`. That handles co-op → member dues
 * on MaybeOS's own account; this handles buyer → co-op with a fee to MaybeOS.
 * Different accounts, different webhooks, different failure modes — D-013 asked
 * for them not to be bolted together, and a bug in one should not be able to
 * misroute the other.
 */
@Injectable()
export class ConnectService {
  private readonly logger = new Logger(ConnectService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const key = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.stripe = new Stripe(
      key || 'sk_test_placeholder',
    // Pinned rather than left to the account default (Stripe's own guidance:
    // "Always specify the API version you're integrating against"). Without
    // this, production billing rides whatever the Stripe account's default
    // happens to be, so a change made in the Dashboard — or by Stripe — alters
    // request and response shapes with no deploy and no diff to point at.
    //
    // `2025-02-24.acacia` is what SDK 17.7.0 targets, so pinning it changes
    // nothing today; it just stops the ground moving. The SDK is two API
    // generations behind current (dahlia) — see OPS-18.
    { apiVersion: '2025-02-24.acacia' },
    );
  }

  /**
   * Start or resume Connect onboarding for a co-op.
   *
   * Stripe's onboarding links are single-use and short-lived, so this creates
   * one every time rather than storing it. The account itself is created once
   * and reused — making a second account for a co-op that abandoned onboarding
   * halfway would strand the first and confuse Stripe's own dashboard.
   */
  /**
   * ⚠️ DEPRECATED PATTERN — must not reach production. See OPS-18.
   *
   * Stripe's current guidance is unambiguous: create connected accounts with
   * Accounts v2 (`POST /v2/core/accounts`) and never with `type: 'standard'`,
   * `'express'` or `'custom'`. This uses the v1 pattern because SDK 17.7.0 has
   * no `v2.core.accounts` at all — the fix needs an SDK upgrade first.
   *
   * Why this is worth blocking a merge rather than fixing later: an account's
   * configuration is set when it is created. Once a co-op has onboarded on a
   * v1 `standard` account, it cannot be restructured into v2's dimensions
   * (dashboard / fees_collector / losses_collector) — you would be asking real
   * co-ops to re-onboard and re-verify their identity and bank details. No
   * co-op has onboarded yet, so this is the last cheap moment to get it right.
   *
   * The target, per Stripe's SaaS-platform mapping:
   *   dashboard: 'full', fees_collector: 'stripe', losses_collector: 'stripe',
   *   configuration.merchant requesting card_payments.
   */
  async createOnboardingLink(
    orgId: string,
    returnUrl: string,
    refreshUrl: string,
  ): Promise<{ url: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      omit: { stripeAccountId: false },
    });
    if (!org) throw new NotFoundException('Organization not found');

    let accountId = org.stripeAccountId;

    if (!accountId) {
      const account = await this.stripe.accounts.create({
        type: 'standard',
        metadata: { orgId },
      });
      accountId = account.id;

      await this.prisma.organization.update({
        where: { id: orgId },
        data: { stripeAccountId: accountId },
      });
      this.logger.log(`Created Connect account ${accountId} for org ${orgId}`);
    }

    const link = await this.stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    return { url: link.url };
  }

  /**
   * Whether this co-op can actually take money yet.
   *
   * Asks Stripe rather than trusting the stored flag, because onboarding
   * completes on Stripe's side and the webhook that tells us can be late or
   * missed. The stored flag is refreshed as a side effect, so the fast path
   * elsewhere stays true.
   */
  /**
   * ⚠️ Uses `charges_enabled`, which Stripe's guidance names as a deprecated
   * v1 field. For direct charges the correct check is
   * `configuration.merchant.capabilities.card_payments.status === 'active'`.
   * Blocked behind the same SDK upgrade — see OPS-18.
   */
  async refreshAccountStatus(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      omit: { stripeAccountId: false },
    });
    if (!org) throw new NotFoundException('Organization not found');

    if (!org.stripeAccountId) {
      return { connected: false, chargesEnabled: false, detailsSubmitted: false };
    }

    const account = await this.stripe.accounts.retrieve(org.stripeAccountId);

    if (account.charges_enabled !== org.stripeChargesEnabled) {
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { stripeChargesEnabled: account.charges_enabled },
      });
    }

    return {
      connected: true,
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
      // Stripe names what is still outstanding; surfacing it beats "not ready".
      requirements: account.requirements?.currently_due ?? [],
    };
  }

  /**
   * Buy a ticket.
   *
   * The charge is created **on the co-op's account** (`stripeAccount` header),
   * not on MaybeOS's with a transfer afterwards. That way the co-op is the
   * merchant of record — its name on the statement, its refund policy, its
   * liability for the event — and MaybeOS's fee is deducted by Stripe rather
   * than moved by us.
   */
  async createTicketCheckout({
    orgId,
    eventId,
    successUrl,
    cancelUrl,
    userId,
    buyerEmail,
  }: {
    orgId: string;
    eventId: string;
    successUrl: string;
    cancelUrl: string;
    userId?: string;
    buyerEmail?: string;
  }): Promise<{ url: string }> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      include: {
        // The account id is omitted globally; charging needs it.
        org: { omit: { stripeAccountId: false } },
        _count: { select: { tickets: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    if (event.priceCents === null) {
      throw new BadRequestException('This event is free — no ticket needed');
    }
    if (event.canceledAt) {
      throw new BadRequestException('This event has been cancelled');
    }
    if (!event.isPublished) {
      throw new BadRequestException('This event is not on sale yet');
    }
    if (event.endTime < new Date()) {
      throw new BadRequestException('This event has already happened');
    }
    if (event.capacity !== null && event._count.tickets >= event.capacity) {
      throw new BadRequestException('This event is sold out');
    }

    const org = event.org;
    if (!org.stripeAccountId || !org.stripeChargesEnabled) {
      // Naming the reason matters: an organiser reading "payments are not set
      // up" knows what to do, where "checkout failed" sends them to support.
      throw new BadRequestException(
        'This co-op has not finished setting up payments, so tickets cannot be sold yet',
      );
    }

    const price = priceTicket({
      ticketCents: event.priceCents,
      plan: org.plan,
      orgFeeCents: org.ticketFeeCents,
    });

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: event.currency,
              unit_amount: price.totalCents,
              product_data: {
                name: event.title,
                description: `${org.name} · ${event.startTime.toDateString()}`,
              },
            },
          },
        ],
        payment_intent_data: {
          // MaybeOS's cut only. The co-op's own fee stays in the co-op's
          // account — sweeping it in here would be MaybeOS taking it.
          application_fee_amount: price.applicationFeeCents,
        },
        ...(buyerEmail ? { customer_email: buyerEmail } : {}),
        metadata: {
          kind: 'event_ticket',
          orgId,
          eventId,
          userId: userId ?? '',
          ticketCents: String(price.ticketCents),
          platformFeeCents: String(price.platformFeeCents),
          orgFeeCents: String(price.orgFeeCents),
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      // On the co-op's account, which is what makes them the merchant.
      { stripeAccount: org.stripeAccountId },
    );

    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL');
    }

    return { url: session.url };
  }

  /**
   * Record a ticket once Stripe confirms payment.
   *
   * Called from the webhook, never from the success redirect: a buyer who
   * closes the tab before being redirected has still paid, and a seat issued
   * on a redirect is a seat sold on the buyer's browser behaving.
   *
   * The unique index on `stripeSessionId` is the idempotency guard — Stripe
   * retries, and a duplicate delivery must not sell the same seat twice.
   */
  async recordTicketFromSession(session: Stripe.Checkout.Session) {
    const meta = session.metadata ?? {};
    if (meta.kind !== 'event_ticket') return null;

    const existing = await this.prisma.ticket.findUnique({
      where: { stripeSessionId: session.id },
    });
    if (existing) return existing;

    const ticket = await this.prisma.ticket.create({
      data: {
        eventId: meta.eventId,
        userId: meta.userId || null,
        buyerEmail: session.customer_details?.email ?? 'unknown',
        buyerName: session.customer_details?.name ?? null,
        amountCents: session.amount_total ?? 0,
        platformFeeCents: Number(meta.platformFeeCents ?? 0),
        orgFeeCents: Number(meta.orgFeeCents ?? 0),
        currency: session.currency ?? 'usd',
        stripeSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
      },
    });

    // A ticket is also an RSVP. Buying one and then being asked to say whether
    // you are coming would be absurd, and the door list reads RSVPs.
    if (meta.userId) {
      await this.prisma.rsvp.upsert({
        where: { eventId_userId: { eventId: meta.eventId, userId: meta.userId } },
        create: { eventId: meta.eventId, userId: meta.userId, status: 'CONFIRMED' },
        update: { status: 'CONFIRMED' },
      });
    } else {
      await this.prisma.rsvp.create({
        data: {
          eventId: meta.eventId,
          guestEmail: ticket.buyerEmail,
          guestName: ticket.buyerName,
          status: 'CONFIRMED',
        },
      });
    }

    this.logger.log(`Ticket ${ticket.id} recorded for event ${meta.eventId}`);
    return ticket;
  }

  /**
   * Refund one ticket, in full, including MaybeOS's cut.
   *
   * `refund_application_fee: true` is the important part and it is a policy
   * choice, not a default. Without it Stripe returns the buyer's money from
   * the co-op's balance and MaybeOS quietly keeps its fee — so a co-op that
   * cancels an event pays MaybeOS for tickets nobody used. The buyer got
   * nothing; nobody should be charged a platform fee for an event that did
   * not happen.
   *
   * `reverse_transfer` is not set: the charge was created directly on the
   * co-op's account rather than transferred to it, so there is no transfer to
   * reverse.
   *
   * What cannot be given back is Stripe's own processing fee. Stripe keeps
   * that on a refund, so a co-op cancelling an event is out of pocket by
   * roughly 2.9% + 30c per ticket. That is Stripe's policy, not ours, and it
   * belongs in the copy the organiser reads before confirming.
   */
  async refundTicket(ticketId: string): Promise<{ refunded: boolean; reason?: string }> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { event: { include: { org: { omit: { stripeAccountId: false } } } } },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    if (ticket.refundedAt) {
      // Idempotent rather than an error: a retried cancellation must not
      // double-refund, and "already refunded" is the desired end state.
      return { refunded: false, reason: 'already refunded' };
    }
    if (!ticket.stripePaymentIntentId) {
      return { refunded: false, reason: 'no payment recorded to refund' };
    }

    const accountId = ticket.event.org.stripeAccountId;
    if (!accountId) {
      return { refunded: false, reason: 'the co-op has no connected account' };
    }

    await this.stripe.refunds.create(
      {
        payment_intent: ticket.stripePaymentIntentId,
        refund_application_fee: true,
      },
      { stripeAccount: accountId },
    );

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { refundedAt: new Date() },
    });

    this.logger.log(`Refunded ticket ${ticketId} (${ticket.amountCents} ${ticket.currency})`);
    return { refunded: true };
  }

  /**
   * Refund every outstanding ticket for an event.
   *
   * Each refund is attempted independently and a failure never stops the
   * rest: if Stripe rejects one card's refund, the other forty buyers should
   * still get their money. The caller gets a summary naming what failed, so a
   * partial failure is visible rather than logged and forgotten.
   */
  async refundEventTickets(eventId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { eventId, refundedAt: null },
      select: { id: true, buyerEmail: true, amountCents: true },
    });

    const refunded: string[] = [];
    const failed: { ticketId: string; buyerEmail: string; reason: string }[] = [];

    for (const ticket of tickets) {
      try {
        const result = await this.refundTicket(ticket.id);
        if (result.refunded) refunded.push(ticket.id);
        else failed.push({ ...ticket, ticketId: ticket.id, reason: result.reason ?? 'unknown' });
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(`Refund failed for ticket ${ticket.id}: ${reason}`);
        failed.push({ ticketId: ticket.id, buyerEmail: ticket.buyerEmail, reason });
      }
    }

    return {
      attempted: tickets.length,
      refunded: refunded.length,
      // Named individually because somebody has to chase these by hand, and a
      // count alone does not say whose money is still missing.
      failed,
    };
  }
}
