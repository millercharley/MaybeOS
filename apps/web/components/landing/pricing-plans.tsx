'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type PublicPricing, type MaybeOsPlanName } from '@/lib/api';
import { bestYearlySaving, money, planFigures, type Interval } from '@/lib/pricing-format';
import { Reveal } from './reveal';
import styles from './landing.module.css';

/**
 * The pricing cards, with real figures (WEB-02, Charley 2026-09-15).
 *
 * The figures are fetched from `/api/pricing`, which reads the live Stripe
 * prices, rather than written into this file. That is the condition MKT-02
 * set for quoting amounts at all: a price changed in Stripe changes here too.
 * Until the figures arrive, or if they cannot be read, each card still says
 * what the plan is, just without a number.
 */

const PLANS: { plan: MaybeOsPlanName; name: string; headline: string; body: string; featured: boolean }[] = [
  {
    plan: 'FREE',
    name: 'Free',
    headline: 'Free to start',
    body: 'No subscription. Flat fees are added on top only when money moves: on tickets, paid bookings and dues.',
    featured: false,
  },
  {
    plan: 'PLUS',
    name: 'Plus',
    headline: 'Priced per member',
    body: 'A lower flat fee on each sale, nothing added to dues, and no member limit. Only members are counted, not guests.',
    featured: true,
  },
  {
    plan: 'UNLIMITED',
    name: 'Unlimited',
    headline: 'One flat price',
    body: 'The lowest flat fee on each sale, nothing added to dues, and the same price however many members you have.',
    featured: false,
  },
];

export function PricingPlans() {
  const [pricing, setPricing] = useState<PublicPricing | null>(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState<Interval>('month');

  useEffect(() => {
    api.pricing
      .get()
      .then(setPricing)
      .catch(() => setFailed(true));
  }, []);

  const saving = pricing ? bestYearlySaving(pricing.plans) : 0;

  return (
    <>
      <div className="mt-10 flex justify-center">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex rounded-full border-[1.5px] border-ink bg-white p-1 shadow-hard-sm"
        >
          {(['month', 'year'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                period === value ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {value === 'month' ? 'Monthly' : 'Yearly'}
              {value === 'year' && saving > 0 && (
                <span className={`ml-1.5 text-xs ${period === value ? 'text-mustard-tint' : 'text-moss'}`}>
                  save up to {saving}%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {PLANS.map((card, i) => {
          const plan = pricing?.plans.find((p) => p.plan === card.plan);
          const figures = plan ? planFigures(plan, period) : null;

          return (
            <Reveal key={card.plan} delay={i * 120}>
              <div
                className={`${styles.lift} flex h-full flex-col rounded-lg border-[1.5px] border-ink bg-white p-7 ${
                  card.featured ? 'shadow-hard-accent' : 'shadow-hard'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">{card.name}</p>
                  {/* What the plan is, in a few words — or, where there is one,
                      how many members it covers (Charley, 2026-09-16). */}
                  <p className="text-sm font-medium text-ink">{figures?.memberLimit ?? card.headline}</p>
                </div>

                <div className="mt-5 min-h-[5.5rem]" aria-live="polite">
                  {figures ? (
                    <>
                      <p className="flex flex-wrap items-baseline gap-x-2">
                        <span key={`${card.plan}-${period}`} className={`${styles.pop} font-display text-3xl text-ink`}>
                          {figures.amount}
                        </span>
                        <span className="text-sm text-ink-soft">{figures.unit}</span>
                      </p>
                      <p className="mt-1 min-h-[1.25rem] text-sm text-moss">{figures.note}</p>
                    </>
                  ) : failed ? (
                    <p className="text-sm text-ink-soft">Current prices are shown in Settings before you choose a plan.</p>
                  ) : (
                    <div className="space-y-2" aria-label="Loading prices">
                      <div className="h-9 w-32 animate-pulse rounded bg-paper-deep" />
                      <div className="h-4 w-44 animate-pulse rounded bg-paper-dim" />
                    </div>
                  )}
                </div>

                <div className="mt-4 space-y-1.5 rounded-md border border-ink/15 bg-paper px-4 py-3 text-sm text-ink">
                  {figures ? (
                    <>
                      <p>
                        <span className="font-mono font-semibold">+ {figures.fee}</span> per ticket or paid booking
                      </p>
                      {figures.duesFee && (
                        <p>
                          <span className="font-mono font-semibold">+ {figures.duesFee}</span> per dues payment, if you
                          charge dues
                        </p>
                      )}
                    </>
                  ) : (
                    <p>A flat fee per ticket or paid booking</p>
                  )}
                </div>

                <p className="mt-5 flex-1 text-sm leading-relaxed text-ink-soft">{card.body}</p>
                {/* Plus and Unlimited go to Stripe Checkout for that plan, after
                    signing up and creating the community (PAY-09). */}
                <Link
                  href={card.plan === 'FREE' ? '/register' : `/start?plan=${card.plan.toLowerCase()}&interval=${period}`}
                  className={`${card.featured ? 'btn-primary' : 'btn-secondary'} mt-7 justify-center`}
                >
                  {card.plan === 'FREE' ? 'Start free' : `Get ${card.name}, ${period === 'month' ? 'monthly' : 'yearly'}`}
                </Link>
              </div>
            </Reveal>
          );
        })}
      </div>

      <Reveal className="mx-auto mt-10 max-w-3xl text-center text-sm text-ink-faint">
        Prices in US dollars. MaybeOS’s fees are added on top of the price you set and shown to the person paying, so they
        never come out of your price. On Plus and Unlimited nothing is added to dues. Stripe’s own processing fees apply.
        An optional written impact report is {pricing ? `${money(pricing.writtenReportCents)} per reporting period` : 'priced separately'}.
        Self-hosting MaybeOS is free, and always will be.
      </Reveal>
    </>
  );
}
