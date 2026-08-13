import { priceBooking } from '../ticket-pricing';

/**
 * What hiring a room costs (SPC-06).
 *
 * `hourlyRate` sat on the Room model since SpaceOS was built and nothing in
 * the API ever read it: a room set to $45/hour, booked for three hours,
 * returned an APPROVED booking with no cost anywhere. These pin the money
 * down before any of it reaches Stripe.
 */
describe('priceBooking', () => {
  const base = {
    hourlyRateCents: 4500,
    startTime: new Date('2026-09-01T09:00:00Z'),
    endTime: new Date('2026-09-01T12:00:00Z'),
    plan: 'FREE' as const,
  };

  it('bills the hours at the room rate', () => {
    // The exact case the roadmap describes: $45/hour for three hours.
    expect(priceBooking(base).hireCents).toBe(13500);
  });

  it('adds MaybeOS to the total instead of taking it out of the hire', () => {
    const p = priceBooking(base);

    // The co-op published $45/hour and must receive $135 for three of them.
    expect(p.hireCents).toBe(13500);
    expect(p.platformFeeCents).toBe(55);
    expect(p.totalCents).toBe(13555);
  });

  it('charges the flat D-013 fee for the plan, not a percentage', () => {
    // A percentage would make a full-day booking worth many times a ticket
    // to MaybeOS for exactly the same work.
    expect(priceBooking({ ...base, plan: 'FREE' }).platformFeeCents).toBe(55);
    expect(priceBooking({ ...base, plan: 'PLUS' }).platformFeeCents).toBe(30);
    expect(priceBooking({ ...base, plan: 'UNLIMITED' }).platformFeeCents).toBe(10);
  });

  it('takes only MaybeOS’s cut as the application fee', () => {
    const p = priceBooking(base);

    expect(p.applicationFeeCents).toBe(p.platformFeeCents);
    expect(p.applicationFeeCents).toBeLessThan(p.hireCents);
  });

  it('bills part-hours pro rata', () => {
    const p = priceBooking({
      ...base,
      endTime: new Date('2026-09-01T10:30:00Z'), // 90 minutes
    });

    expect(p.hireCents).toBe(6750);
  });

  it('rounds a fractional cent up, so the co-op is never short', () => {
    // 20 minutes of $10/hour is 333.33 cents. Rounding down would hand the
    // co-op 3.33 and quietly lose the rest on every booking.
    const p = priceBooking({
      hourlyRateCents: 1000,
      startTime: new Date('2026-09-01T09:00:00Z'),
      endTime: new Date('2026-09-01T09:20:00Z'),
      plan: 'FREE',
    });

    expect(p.hireCents).toBe(334);
  });

  it('refuses a rate that is not a positive whole number of cents', () => {
    // Money in floats is how a ledger stops adding up.
    expect(() => priceBooking({ ...base, hourlyRateCents: 0 })).toThrow();
    expect(() => priceBooking({ ...base, hourlyRateCents: -100 })).toThrow();
    expect(() => priceBooking({ ...base, hourlyRateCents: 45.5 })).toThrow();
  });

  it('refuses a booking that does not move forwards', () => {
    expect(() =>
      priceBooking({ ...base, endTime: new Date('2026-09-01T09:00:00Z') }),
    ).toThrow();
    expect(() =>
      priceBooking({ ...base, endTime: new Date('2026-09-01T08:00:00Z') }),
    ).toThrow();
  });
});
