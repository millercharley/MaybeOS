import { priceTicket, MAX_SEATS_PER_PURCHASE, describeFees } from '../ticket-pricing';

/**
 * Buying more than one seat at once (EVT-47).
 *
 * There was no way to. Checkout was created with a hardcoded `quantity: 1`
 * and the event page offered no control, so two seats meant two trips through
 * Stripe — which is exactly what Annette Neblett and James Knowles each did
 * on *Dog Sees God*, and what made Annette write in asking where her tickets
 * were.
 */
describe('pricing a multi-seat purchase', () => {
  const base = { ticketCents: 1000, plan: 'FREE' as const, orgFeeCents: 75 };

  it('still prices one seat exactly as it did before', () => {
    expect(priceTicket(base)).toMatchObject({
      quantity: 1,
      ticketCents: 1000,
      platformFeeCents: 100,
      orgFeeCents: 75,
      unitTotalCents: 1175,
      totalCents: 1175,
      applicationFeeCents: 100,
    });
  });

  /** Annette's purchase, as it should have been possible to make it. */
  it('multiplies the whole thing by the seats', () => {
    expect(priceTicket({ ...base, quantity: 2 })).toMatchObject({
      quantity: 2,
      unitTotalCents: 1175,
      totalCents: 2350,
      applicationFeeCents: 200,
    });
  });

  /**
   * The decision EVT-47 had to make, pinned so it cannot drift silently.
   *
   * MaybeOS's own documents disagree: D-013 says a flat fee per *transaction*,
   * the public pricing page says per *ticket*. Until there was a selector the
   * two were the same number. Per seat is what has actually been charged —
   * two checkouts meant two fees — so the selector changes how often somebody
   * types their card in and nothing about what anyone is paid.
   */
  it('charges MaybeOS’s fee for every seat, not once per purchase', () => {
    const one = priceTicket({ ...base, quantity: 1 });
    const three = priceTicket({ ...base, quantity: 3 });

    expect(three.applicationFeeCents).toBe(one.platformFeeCents * 3);
    expect(three.totalCents).toBe(one.totalCents * 3);
  });

  /**
   * The co-op's fee is the co-op's money and must never reach Stripe's
   * application fee, however many seats multiply it. This is the mistake
   * `applicationFeeCents` exists to prevent, now with more ways to make it.
   */
  it('never sweeps the co-op’s own fee into MaybeOS’s cut', () => {
    const price = priceTicket({ ...base, orgFeeCents: 500, quantity: 4 });

    expect(price.applicationFeeCents).toBe(400);
    expect(price.totalCents).toBe((1000 + 100 + 500) * 4);
  });

  it('keeps the per-seat breakdown per seat', () => {
    const price = priceTicket({ ...base, quantity: 3 });

    expect(price.ticketCents).toBe(1000);
    expect(price.platformFeeCents).toBe(100);
    expect(price.orgFeeCents).toBe(75);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['above the cap', MAX_SEATS_PER_PURCHASE + 1],
  ])('refuses to price %s seats', (_label, quantity) => {
    expect(() => priceTicket({ ...base, quantity })).toThrow(/Seats must be/);
  });

  it('prices right up to the cap', () => {
    expect(priceTicket({ ...base, quantity: MAX_SEATS_PER_PURCHASE }).totalCents).toBe(
      1175 * MAX_SEATS_PER_PURCHASE,
    );
  });

  describe('what the buyer is told', () => {
    /**
     * The figures beside the word have to add up. Multiplying the total while
     * leaving "($1.00 MaybeOS, $0.75 venue)" next to it reads as an
     * arithmetic error to the one person guaranteed to check: the buyer.
     */
    it('says fees are each when there is more than one', () => {
      expect(describeFees(priceTicket({ ...base, quantity: 2 }))).toBe(
        '+ $1.75 in fees each ($1.00 MaybeOS, $0.75 venue)',
      );
    });

    it('says nothing about each for a single seat', () => {
      expect(describeFees(priceTicket(base))).toBe(
        '+ $1.75 in fees ($1.00 MaybeOS, $0.75 venue)',
      );
    });

    it('says nothing at all when nothing is added', () => {
      expect(
        describeFees({
          quantity: 3,
          ticketCents: 1000,
          platformFeeCents: 0,
          orgFeeCents: 0,
          unitTotalCents: 1000,
          totalCents: 3000,
          applicationFeeCents: 0,
        }),
      ).toBeNull();
    });
  });
});
