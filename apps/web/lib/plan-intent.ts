/**
 * The paid plan somebody chose on the landing page, carried through signing up
 * and creating their community to Stripe Checkout (PAY-09).
 *
 * In localStorage, because the journey crosses page loads: register, then the
 * community form. Kept for a day, so a plan picked last week does not ambush
 * somebody creating a community today.
 */

export type PaidPlan = 'PLUS' | 'UNLIMITED';
export type BillingInterval = 'month' | 'year';

export interface PlanIntent {
  plan: PaidPlan;
  interval: BillingInterval;
}

const KEY = 'maybeos_plan_intent';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A plan and interval from a URL or storage, or null if they are not a real choice. */
export function parsePlanIntent(plan: string | null | undefined, interval: string | null | undefined): PlanIntent | null {
  const p = (plan ?? '').toUpperCase();
  const i = (interval ?? 'month').toLowerCase();
  if (p !== 'PLUS' && p !== 'UNLIMITED') return null;
  if (i !== 'month' && i !== 'year') return null;
  return { plan: p, interval: i };
}

export function savePlanIntent(intent: PlanIntent, now: number = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...intent, at: now }));
  } catch {
    // Private mode or storage blocked: the visitor can still choose the plan in Settings.
  }
}

/** Reads and removes the intent, so it is acted on once. */
export function takePlanIntent(now: number = Date.now()): PlanIntent | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { plan?: string; interval?: string; at?: number };
    if (!stored.at || now - stored.at > DAY_MS) return null;
    return parsePlanIntent(stored.plan, stored.interval);
  } catch {
    return null;
  }
}
