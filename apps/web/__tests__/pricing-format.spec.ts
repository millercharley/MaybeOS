import { bestYearlySaving, money, planFigures } from '../lib/pricing-format';
import type { PublicPlan } from '../lib/api';

/** The live prices on 2026-09-15, as the API returns them. The page itself holds no amounts. */
const FREE: PublicPlan = { plan: 'FREE', monthlyCents: 0, yearlyCents: 0, perMember: false, transactionFeeCents: 100 };
const PLUS: PublicPlan = { plan: 'PLUS', monthlyCents: 50, yearlyCents: 365, perMember: true, transactionFeeCents: 30 };
const UNLIMITED: PublicPlan = { plan: 'UNLIMITED', monthlyCents: 34900, yearlyCents: 358800, perMember: false, transactionFeeCents: 10 };

describe('pricing words', () => {
  it('writes whole dollars without cents, and fees always with them', () => {
    expect(money(0)).toBe('$0');
    expect(money(34900)).toBe('$349');
    expect(money(358800)).toBe('$3,588');
    expect(money(50)).toBe('$0.50');
    expect(money(100, { cents: true })).toBe('$1.00');
  });

  it('describes each plan monthly', () => {
    expect(planFigures(FREE, 'month')).toEqual({ amount: '$0', unit: 'a month', note: null, fee: '$1.00' });
    expect(planFigures(PLUS, 'month')).toEqual({ amount: '$0.50', unit: 'per member a month', note: null, fee: '$0.30' });
    expect(planFigures(UNLIMITED, 'month')).toEqual({ amount: '$349', unit: 'a month', note: null, fee: '$0.10' });
  });

  it('describes each plan yearly, with what it saves', () => {
    expect(planFigures(FREE, 'year')).toEqual({ amount: '$0', unit: 'a year', note: null, fee: '$1.00' });
    expect(planFigures(PLUS, 'year')).toEqual({
      amount: '$3.65',
      unit: 'per member a year',
      note: 'About $0.30 per member a month. Save 39%.',
      fee: '$0.30',
    });
    expect(planFigures(UNLIMITED, 'year')).toEqual({
      amount: '$3,588',
      unit: 'a year',
      note: '$299 a month, billed yearly. Save 14%.',
      fee: '$0.10',
    });
  });

  it('shows nothing rather than a guess when a price is unknown', () => {
    expect(planFigures({ ...PLUS, yearlyCents: null }, 'year')).toBeNull();
  });

  it('labels the toggle with the largest saving', () => {
    expect(bestYearlySaving([FREE, PLUS, UNLIMITED])).toBe(39);
  });
});
