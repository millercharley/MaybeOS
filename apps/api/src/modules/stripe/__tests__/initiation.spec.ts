import {
  MAX_INITIATION_CENTS,
  describeInitiation,
  initiationOwed,
  initiationProblem,
} from '../initiation';

/**
 * The one-time fee for joining a co-op (PAY-10).
 *
 * Charley: "Some organizations will need to charge a one-time initiation fee
 * for their memberships."
 *
 * Every test here is a way of charging somebody the wrong amount, which is
 * the only kind of bug this feature can have that costs a co-op a member.
 */
describe('what a member owes to join', () => {
  it('asks for the fee from somebody who has never paid one', () => {
    expect(initiationOwed({ tierInitiationCents: 5000, alreadyPaidAt: null })).toEqual({
      cents: 5000,
      reason: 'owed',
    });
  });

  it('asks for nothing on a tier that charges nothing', () => {
    expect(initiationOwed({ tierInitiationCents: 0, alreadyPaidAt: null }).cents).toBe(0);
    expect(initiationOwed({ tierInitiationCents: null, alreadyPaidAt: null }).cents).toBe(0);
  });

  it('never charges the same member twice', () => {
    /*
      The expensive one. Moving between tiers is not joining again, and a
      co-op that charged for it would be charging somebody for changing their
      mind — which is the version of this feature that generates refund
      requests rather than revenue.
    */
    const owed = initiationOwed({
      tierInitiationCents: 5000,
      alreadyPaidAt: new Date('2026-01-01'),
    });
    expect(owed).toEqual({ cents: 0, reason: 'already-paid' });
  });

  it('charges somebody moving up from a free tier they joined for nothing', () => {
    // They have never paid one, so the tier they are joining decides.
    expect(
      initiationOwed({ tierInitiationCents: 2500, alreadyPaidAt: null }).cents,
    ).toBe(2500);
  });

  it('refuses to invent money from a negative or fractional amount', () => {
    expect(initiationOwed({ tierInitiationCents: -5000, alreadyPaidAt: null }).cents).toBe(0);
    expect(initiationOwed({ tierInitiationCents: 10.7, alreadyPaidAt: null }).cents).toBe(10);
  });
});

describe('what an admin may set', () => {
  it('takes an ordinary amount', () => {
    expect(initiationProblem(5000)).toBeNull();
    expect(initiationProblem(0)).toBeNull();
  });

  it('refuses a negative fee', () => {
    expect(initiationProblem(-1)).toMatch(/negative/i);
  });

  it('refuses a number that is almost certainly a typo', () => {
    // A co-op meaning $50 and typing cents in the dollars box asks for
    // $5,000. The cap is low enough to catch that and high enough that a
    // real joining fee passes.
    expect(initiationProblem(MAX_INITIATION_CENTS + 1)).toMatch(/typo/i);
    expect(initiationProblem(MAX_INITIATION_CENTS)).toBeNull();
  });

  it('refuses fractional cents', () => {
    expect(initiationProblem(1000.5)).toMatch(/whole number/i);
  });
});

describe('what the member is told', () => {
  it('says the fee alongside the dues, before they pay', () => {
    // A one-off charge somebody meets for the first time at the card form is
    // the charge they dispute — which costs the co-op the fee as well as the
    // money.
    expect(describeInitiation(5000, '$15/month')).toBe(
      '$15/month, plus a one-time $50 joining fee',
    );
  });

  it('keeps the cents when there are cents to keep', () => {
    expect(describeInitiation(2550, '$15/month')).toContain('$25.50');
  });

  it('says nothing extra when there is no fee', () => {
    expect(describeInitiation(0, '$15/month')).toBe('$15/month');
  });
});
