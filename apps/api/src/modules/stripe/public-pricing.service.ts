import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MaybeOsPlan } from '@prisma/client';
import Stripe from 'stripe';
import { ADVERTISED_PRICE_IDS, PER_MEMBER_PRICE_IDS } from './maybeos-plans';
import { PLATFORM_FEE_CENTS } from './ticket-pricing';
import { WRITTEN_REPORT_PRICE_CENTS } from '../impact/report-pricing';
import { DUES_FEE_CENTS, FREE_PLAN_MEMBER_LIMIT } from './dues-pricing';

export interface PublicPlan {
  plan: MaybeOsPlan;
  /** Null when Stripe could not be read, or the price is no longer active. */
  monthlyCents: number | null;
  yearlyCents: number | null;
  /** Whether the subscription is charged per member (Plus). */
  perMember: boolean;
  /** MaybeOS's flat fee on each ticket or paid booking. */
  transactionFeeCents: number;
  /** Added to each dues payment, when the co-op charges dues (PAY-09). 0 for none. */
  duesFeeCents: number;
  /** Members allowed, not counting guests. Null for no limit. */
  memberLimit: number | null;
}

export interface PublicPricing {
  currency: 'usd';
  plans: PublicPlan[];
  writtenReportCents: number;
}

/** How long the figures are kept before Stripe is asked again. */
const CACHE_MS = 60 * 60 * 1000;
const ORDER: MaybeOsPlan[] = ['FREE', 'PLUS', 'UNLIMITED'];

/**
 * MaybeOS's own prices, for the public landing page (WEB-02).
 *
 * Charley asked for real figures on the pricing section. MKT-02 kept figures
 * off the page because prose quoting a price drifts from the price, so the
 * figures here come from the only place that cannot drift: the subscription
 * amounts from the live Stripe prices themselves, and the transaction fee and
 * report price from the constants that billing charges.
 *
 * Read from Stripe at most once an hour per server instance, so a busy landing
 * page does not become Stripe traffic. If Stripe cannot be read, the last good
 * answer is served; with none, the amounts are null and the page shows the
 * shape of the pricing without figures rather than a guess.
 */
@Injectable()
export class PublicPricingService {
  private readonly logger = new Logger(PublicPricingService.name);
  private readonly stripe: Stripe | null;
  private cache: { at: number; value: PublicPricing } | null = null;
  private inFlight: Promise<PublicPricing> | null = null;

  constructor(config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key, { apiVersion: '2026-07-29.dahlia' }) : null;
  }

  async pricing(now: number = Date.now()): Promise<PublicPricing> {
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.value;
    if (!this.inFlight) {
      this.inFlight = this.read()
        .then((value) => {
          if (value.plans.every((p) => p.monthlyCents !== null && p.yearlyCents !== null)) {
            this.cache = { at: now, value };
          }
          return this.cache?.value ?? value;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  private async read(): Promise<PublicPricing> {
    const amount = async (id: string, interval: 'month' | 'year'): Promise<number | null> => {
      if (!this.stripe) return null;
      try {
        const price = await this.stripe.prices.retrieve(id);
        // A price that was archived, changed currency or changed interval is
        // not what a co-op can buy today, so it is not advertised.
        if (!price.active || price.currency !== 'usd' || price.recurring?.interval !== interval) {
          this.logger.warn(`Advertised price ${id} is not an active usd ${interval} price`);
          return null;
        }
        return price.unit_amount;
      } catch (error) {
        this.logger.error(`Could not read price ${id}: ${(error as Error).message}`);
        return null;
      }
    };

    const plans = await Promise.all(
      ORDER.map(async (plan): Promise<PublicPlan> => {
        const ids = ADVERTISED_PRICE_IDS[plan];
        const [monthlyCents, yearlyCents] = await Promise.all([amount(ids.month, 'month'), amount(ids.year, 'year')]);
        return {
          plan,
          monthlyCents,
          yearlyCents,
          perMember: PER_MEMBER_PRICE_IDS.has(ids.month),
          transactionFeeCents: PLATFORM_FEE_CENTS[plan],
          duesFeeCents: DUES_FEE_CENTS[plan],
          memberLimit: plan === 'FREE' ? FREE_PLAN_MEMBER_LIMIT : null,
        };
      }),
    );

    return { currency: 'usd', plans, writtenReportCents: WRITTEN_REPORT_PRICE_CENTS };
  }
}
