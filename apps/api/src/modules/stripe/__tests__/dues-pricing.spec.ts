import { applicationFeePercent, duesFeeFor, feeFromPercent, FREE_PLAN_MEMBER_LIMIT } from '../dues-pricing';

/** The Free plan's dues fee and member limit (PAY-09, Charley 2026-09-15). */
describe('dues pricing', () => {
  it('adds $2.00 to dues on Free, and nothing on Plus or Unlimited', () => {
    expect(duesFeeFor('FREE', 1000)).toBe(200);
    expect(duesFeeFor('PLUS', 1000)).toBe(0);
    expect(duesFeeFor('UNLIMITED', 1000)).toBe(0);
  });

  it('charges no fee on a $0 tier, which is not a dues payment', () => {
    expect(duesFeeFor('FREE', 0)).toBe(0);
  });

  it('caps Free at 1,000 members (Charley, 2026-09-16)', () => {
    expect(FREE_PLAN_MEMBER_LIMIT).toBe(1000);
  });

  it('takes within a cent of the flat fee for any dues from $0.50 to $200', () => {
    let worst = 0;
    for (let dues = 50; dues <= 20000; dues += 1) {
      const percent = applicationFeePercent(dues, 200);
      worst = Math.max(worst, Math.abs(feeFromPercent(dues + 200, percent) - 200));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('takes exactly $2.00 on common dues amounts', () => {
    for (const dues of [450, 700, 1000, 1500, 1950, 2500, 5000]) {
      expect(feeFromPercent(dues + 200, applicationFeePercent(dues, 200))).toBe(200);
    }
  });
});
