import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../config/prisma.service';
import {
  ScanInterval,
  ScanSubscription,
  MemberSnapshot,
  TierSnapshot,
  PlannedRow,
  PriceGroup,
  ScanSummary,
  groupPrices,
  planRows,
  normalizeEmail,
  summarize,
} from './adoption-scan';

/**
 * Look at a co-op's existing Stripe subscriptions and report what adopting
 * them would mean (MIG-01). **Reads only.**
 *
 * Nothing here writes to Stripe and nothing here writes to the database. That
 * is the point of it: before building anything that links a live subscription
 * to a membership, the questions worth answering are how many customers match
 * by email at all, how many distinct prices are in use, and whether the two
 * systems agree on what the co-op earns. None of those can be answered by
 * reading code — only by reading the co-op's actual Stripe account.
 *
 * The subscriptions live on the **connected** account (PAY-05 links it with
 * `read_write`), not MaybeOS's own. They are already in the right place: the
 * money already lands in the co-op's bank and every billing date is already
 * set. Adoption is a database write, not a payment migration — no card is
 * re-entered and no member is asked to do anything.
 */
@Injectable()
export class AdoptionScanService {
  private readonly logger = new Logger(AdoptionScanService.name);
  private readonly stripe: Stripe;

  /**
   * Statuses worth scanning: the ones where money is being collected, or is
   * meant to be. Canceled subscriptions are deliberately not read — a co-op's
   * account holds years of them, they are not memberships, and pulling them
   * would turn a bounded scan into an unbounded one.
   */
  private static readonly SCANNED_STATUSES = ['active', 'trialing', 'past_due'] as const;

  /**
   * A ceiling, not an expectation. This runs in a Lambda with a wall clock,
   * and a scan that dies half way through is worse than one that says it
   * stopped: a truncated list still reports honestly, via `truncated`.
   */
  private static readonly MAX_SUBSCRIPTIONS = 2000;

  /** Product names are cosmetic, so their lookup is capped and best-effort. */
  private static readonly MAX_PRODUCT_LOOKUPS = 25;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.stripe = new Stripe(
      this.configService.get<string>('STRIPE_SECRET_KEY') || 'sk_test_placeholder',
      { apiVersion: '2026-07-29.dahlia' },
    );
  }

  async scan(orgId: string): Promise<{
    scannedAt: string;
    truncated: boolean;
    prices: PriceGroup[];
    summary: ScanSummary;
    rows: PlannedRow[];
  }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      // Named in `select`, which is what lifts the client-level omit on this
      // column. `omit` alongside `select` is rejected outright by Prisma.
      select: {
        id: true,
        stripeAccountId: true,
        stripeChargesEnabled: true,
      },
    });

    if (!org) throw new NotFoundException('Organization not found');

    if (!org.stripeAccountId) {
      throw new BadRequestException(
        'This co-op has not connected a Stripe account, so there are no existing subscriptions to read.',
      );
    }

    const { subs, truncated } = await this.readSubscriptions(org.stripeAccountId);
    await this.nameProducts(subs, org.stripeAccountId);

    const [members, tiers] = await Promise.all([
      this.readMembers(orgId),
      this.readTiers(orgId),
    ]);

    const rows = planRows(subs, members);

    return {
      scannedAt: new Date().toISOString(),
      truncated,
      prices: groupPrices(subs, tiers),
      summary: summarize(subs, rows, members),
      rows,
    };
  }

  /**
   * Every live subscription on the co-op's account.
   *
   * One call per status rather than `status: 'all'`, which would drag in the
   * whole cancelled history to be filtered away afterwards.
   */
  private async readSubscriptions(
    accountId: string,
  ): Promise<{ subs: ScanSubscription[]; truncated: boolean }> {
    const subs: ScanSubscription[] = [];
    let truncated = false;

    for (const status of AdoptionScanService.SCANNED_STATUSES) {
      const remaining = AdoptionScanService.MAX_SUBSCRIPTIONS - subs.length;
      if (remaining <= 0) {
        truncated = true;
        break;
      }

      let page: Stripe.Subscription[];
      try {
        page = await this.stripe.subscriptions
          .list(
            { status, limit: 100, expand: ['data.customer'] },
            { stripeAccount: accountId },
          )
          .autoPagingToArray({ limit: remaining });
      } catch (err) {
        this.scanFailed(err, status);
      }

      if (page.length === remaining) truncated = true;
      subs.push(...page.map((sub) => this.toScanSubscription(sub)));
    }

    return { subs, truncated };
  }

  private toScanSubscription(sub: Stripe.Subscription): ScanSubscription {
    const customer = sub.customer;
    const live =
      customer && typeof customer !== 'string' && !customer.deleted
        ? (customer as Stripe.Customer)
        : null;

    return {
      id: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      currentPeriodEnd: this.periodEnd(sub),
      customerId: typeof customer === 'string' ? customer : (customer?.id ?? null),
      // A subscription can carry its own billing email; it is the one Stripe
      // actually sends invoices to, so it wins over the customer's.
      email: live?.email ?? null,
      name: live?.name ?? null,
      items: (sub.items?.data ?? []).map((item) => ({
        priceId: item.price?.id ?? 'unknown',
        productId: typeof item.price?.product === 'string' ? item.price.product : null,
        productName: null,
        unitAmountCents: item.price?.unit_amount ?? null,
        quantity: item.quantity ?? 1,
        interval: (item.price?.recurring?.interval as ScanInterval | undefined) ?? null,
        intervalCount: item.price?.recurring?.interval_count ?? 1,
      })),
    };
  }

  /**
   * When the paid period runs out.
   *
   * Read off the subscription *item*, not the subscription: Stripe moved
   * `current_period_end` onto items, and reading the old place returns
   * undefined against the pinned API version rather than failing loudly.
   */
  private periodEnd(sub: Stripe.Subscription): Date | null {
    const seconds = sub.items?.data?.[0]?.current_period_end ?? sub.cancel_at ?? null;
    return seconds ? new Date(seconds * 1000) : null;
  }

  /**
   * Put real product names on the price groups.
   *
   * Not expanded during the list: `data.items.data.price.product` is five
   * levels deep and Stripe expands four. Fetched separately, capped, and
   * failing quietly — a scan that cannot name a product is still a scan, and
   * this is the only cosmetic thing in it.
   */
  private async nameProducts(subs: ScanSubscription[], accountId: string): Promise<void> {
    const productIds = new Set<string>();
    const itemsByProduct = new Map<string, typeof subs[number]['items']>();

    for (const sub of subs) {
      for (const item of sub.items) {
        if (item.productId) {
          productIds.add(item.productId);
          const bucket = itemsByProduct.get(item.productId) ?? [];
          bucket.push(item);
          itemsByProduct.set(item.productId, bucket);
        }
      }
    }

    for (const productId of [...productIds].slice(0, AdoptionScanService.MAX_PRODUCT_LOOKUPS)) {
      try {
        const product = await this.stripe.products.retrieve(
          productId,
          {},
          { stripeAccount: accountId },
        );
        for (const item of itemsByProduct.get(productId) ?? []) {
          item.productName = product.name ?? null;
        }
      } catch (err) {
        this.logger.warn(
          `Could not read product ${productId} while scanning: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async readMembers(orgId: string): Promise<MemberSnapshot[]> {
    const memberships = await this.prisma.userOrg.findMany({
      where: { orgId },
      select: {
        id: true,
        stripeSubscriptionId: true,
        subscriptionStatus: true,
        user: { select: { email: true } },
        tier: { select: { name: true, priceMonthly: true } },
      },
    });

    return memberships.map((membership) => ({
      userOrgId: membership.id,
      email: normalizeEmail(membership.user.email),
      stripeSubscriptionId: membership.stripeSubscriptionId,
      subscriptionStatus: membership.subscriptionStatus,
      tierName: membership.tier?.name ?? null,
      tierMonthlyCents: membership.tier?.priceMonthly ?? null,
    }));
  }

  private async readTiers(orgId: string): Promise<TierSnapshot[]> {
    return this.prisma.membershipTier.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true, priceMonthly: true, isPayWhatYouCan: true },
    });
  }

  /**
   * Stripe refused the read.
   *
   * The overwhelmingly likely cause is the platform's **restricted key**
   * lacking permission on connected accounts — the same class of failure that
   * broke ticket checkout and refunds. Stripe's own message names the key, the
   * account and the missing scope; it is logged in full and not returned,
   * because the viewer is a co-op admin and that key is MaybeOS's, not theirs.
   */
  private scanFailed(err: unknown, status: string): never {
    const detail = err instanceof Error ? err.message : String(err);
    this.logger.error(`Subscription scan failed (${status}): ${detail}`);

    throw new BadRequestException(
      "MaybeOS could not read this account's subscriptions from Stripe. Nothing was changed. The reason is in the server logs.",
    );
  }
}
