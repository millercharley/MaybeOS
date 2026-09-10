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
  describeStripeFailure,
  PriceToTier,
  TierSnapshot as Tier,
} from './adoption-scan';
import { membershipStatusFor } from './subscription-status';

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

  async scan(
    orgId: string,
    mapping: PriceToTier = {},
  ): Promise<{
    scannedAt: string;
    truncated: boolean;
    prices: PriceGroup[];
    tiers: TierSnapshot[];
    summary: ScanSummary;
    rows: PlannedRow[];
  }> {
    const { subs, truncated, members, tiers } = await this.read(orgId);

    const prices = groupPrices(subs, tiers);
    const rows = planRows(subs, members, mapping);

    return {
      scannedAt: new Date().toISOString(),
      truncated,
      prices,
      // The mapping screen needs every tier to choose from, not only the ones
      // a price happens to match. Requiring the amounts to agree is what made
      // a co-op edit its live price list to import its own history.
      tiers,
      summary: summarize(subs, rows, members, prices),
      rows,
    };
  }

  /** Everything both the scan and the adoption need, read once. */
  private async read(orgId: string) {
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

    // Stable order, so a batched adoption can walk the list with a cursor and
    // resume exactly where it stopped even though Stripe was re-read.
    subs.sort((a, b) => a.id.localeCompare(b.id));

    return { subs, truncated, members, tiers };
  }


  /**
   * Write the adoption: link live Stripe subscriptions onto memberships.
   *
   * The only method here that writes anything. It re-reads Stripe rather than
   * trusting a plan the browser sends back, so a mapping is the only thing the
   * caller decides — the money, the status and the dates always come from
   * Stripe at the moment of writing.
   *
   * **Idempotent.** Matching is on the subscription id, so a second run over
   * the same batch refreshes the same rows instead of duplicating them, and a
   * run that dies half way can simply be run again.
   *
   * Batched with a cursor because 371 memberships do not fit in one Lambda's
   * wall clock, and a partial import that reports honestly is worth far more
   * than a whole one that times out and leaves nobody sure what landed.
   */
  async adopt(
    orgId: string,
    options: { mapping: PriceToTier; dryRun: boolean; limit?: number; after?: string },
  ) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const { subs, members, tiers } = await this.read(orgId);

    const known = new Set(tiers.map((tier) => tier.id));
    for (const tierId of Object.values(options.mapping)) {
      // A tier from another co-op would hand this org's members someone
      // else's price (SEC-04). Checked against the tiers actually read for
      // this org rather than looked up by bare id.
      if (!known.has(tierId)) {
        throw new BadRequestException('A chosen tier does not belong to this co-op');
      }
    }

    const rows = planRows(subs, members, options.mapping);
    const paired = subs.map((sub, index) => ({ sub, row: rows[index] }));

    const start = options.after
      ? paired.findIndex(({ sub }) => sub.id === options.after) + 1
      : 0;
    const batch = options.dryRun ? paired : paired.slice(start, start + limit);

    const counts = {
      linked: 0,
      created: 0,
      refreshed: 0,
      skipped: 0,
      errors: [] as Array<{ email: string; reason: string }>,
    };
    const byConflict: Record<string, number> = {};

    for (const { sub, row } of batch) {
      if (row.outcome === 'conflict') {
        counts.skipped++;
        if (row.conflict) byConflict[row.conflict] = (byConflict[row.conflict] ?? 0) + 1;
        continue;
      }

      // The scan deliberately stays quiet about tiers until the admin has
      // mapped something, so the first look at the page is not a wall of
      // conflicts. **Writing cannot inherit that silence**: an empty mapping
      // would create memberships holding a subscription and no tier — paying
      // members with no membership level, which reads as a data problem long
      // after the import is forgotten.
      if (!row.tierId) {
        counts.skipped++;
        byConflict['no-tier-for-price'] = (byConflict['no-tier-for-price'] ?? 0) + 1;
        continue;
      }

      const status = membershipStatusFor(sub.status);
      if (!status) {
        // PLT-07's rule, applied at the point of creation: a Stripe status
        // this product has no word for is not written as a guess.
        counts.skipped++;
        byConflict['unmapped-status'] = (byConflict['unmapped-status'] ?? 0) + 1;
        continue;
      }

      if (options.dryRun) {
        if (row.outcome === 'create') counts.created++;
        else if (row.outcome === 'link') counts.linked++;
        else counts.refreshed++;
        continue;
      }

      try {
        await this.writeRow(orgId, sub, row, status, counts);
      } catch (err) {
        counts.errors.push({
          email: row.email ?? sub.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const last = batch.at(-1)?.sub.id ?? options.after ?? null;
    const done = options.dryRun || start + batch.length >= paired.length;

    return {
      dryRun: options.dryRun,
      total: paired.length,
      processed: batch.length,
      counts,
      byConflict,
      nextAfter: done ? null : last,
      done,
    };
  }

  /** One membership, from one live subscription. */
  private async writeRow(
    orgId: string,
    sub: ScanSubscription,
    row: PlannedRow,
    status: string,
    counts: { linked: number; created: number; refreshed: number },
  ): Promise<void> {
    const billing = {
      tierId: row.tierId,
      stripeCustomerId: sub.customerId,
      stripeSubscriptionId: sub.id,
      subscriptionStatus: status as never,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      currentPeriodEnd: sub.currentPeriodEnd,
    };

    if (row.userOrgId) {
      await this.prisma.userOrg.update({ where: { id: row.userOrgId }, data: billing });
      if (row.outcome === 'already-linked') counts.refreshed++;
      else counts.linked++;
      return;
    }

    const email = row.email as string;

    // A User can exist without being a member here — someone who belongs to
    // another co-op, or who signed up and never joined. Reused, never
    // duplicated: email is unique on User and a second insert would throw.
    const user =
      (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) ??
      (await this.prisma.user.create({
        // No password and unverified, exactly as the .csv import does: this
        // account was made *for* somebody rather than *by* them.
        data: { email, name: sub.name ?? null },
        select: { id: true },
      }));

    await this.prisma.userOrg.create({
      data: {
        userId: user.id,
        orgId,
        role: 'MEMBER',
        // When Stripe first billed them. Truer than today, and truer than a
        // join date exported by the platform they are leaving.
        ...(sub.startedAt ? { memberSince: sub.startedAt } : {}),
        ...billing,
      },
    });
    counts.created++;
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
      // Stripe's own record of when this member started paying. Better than a
      // CSV's join date, which is whatever the last platform chose to export.
      startedAt: sub.start_date ? new Date(sub.start_date * 1000) : null,
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
   * account and the missing scope, so it is logged and never returned; what
   * goes back is the enum-like `type` and `code` plus the fix in words.
   *
   * "The reason is in the server logs" is not an option here. These logs need
   * a Netlify token nobody currently holds, and a 400 never reaches Sentry —
   * so the first version of this message was a dead end for the one person who
   * could act on it.
   */
  private scanFailed(err: unknown, status: string): never {
    const detail = err instanceof Error ? err.message : String(err);
    this.logger.error(`Subscription scan failed (${status}): ${detail}`);

    throw new BadRequestException(describeStripeFailure(err).message);
  }
}
