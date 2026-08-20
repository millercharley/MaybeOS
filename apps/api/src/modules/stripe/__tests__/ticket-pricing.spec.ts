import {
  PLATFORM_FEE_CENTS,
  describeFees,
  priceTicket,
} from '../ticket-pricing';

/**
 * How ticket money splits (D-013).
 *
 * These numbers are Charley's pricing recorded verbatim in a decision record,
 * so the tests assert them literally rather than deriving them. If someone
 * changes a rate, this suite should fail and make them go and change D-013
 * too — a pricing change that only exists in code is a pricing change nobody
 * agreed to.
 */
describe('ticket pricing', () => {
  describe('what MaybeOS takes', () => {
    it('is a flat fee per transaction, by plan', () => {
      // Charley's live pricing table, 2026-08-21. FREE went 55 → 100 and the
      // $100 initiation fee was removed.
      expect(PLATFORM_FEE_CENTS).toEqual({ FREE: 100, PLUS: 30, UNLIMITED: 10 });
    });

    it.each([
      ['FREE', 100],
      ['PLUS', 30],
      ['UNLIMITED', 10],
    ] as const)('charges %s plan %d cents whatever the ticket costs', (plan, fee) => {
      // Flat, not proportional: the same on a $5 ticket and a $500 one.
      expect(priceTicket({ ticketCents: 500, plan }).platformFeeCents).toBe(fee);
      expect(priceTicket({ ticketCents: 50000, plan }).platformFeeCents).toBe(fee);
    });
  });

  describe('what the co-op receives', () => {
    it('adds the fees on top rather than taking them out', () => {
      // A co-op pricing a ticket at $10 should receive $10. Deducting fees
      // would mean it quietly earns less than the number it published.
      const b = priceTicket({ ticketCents: 1000, plan: 'FREE' });

      expect(b.ticketCents).toBe(1000);
      expect(b.totalCents).toBe(1100);
    });

    it('adds the co-op\'s own fee as well', () => {
      const b = priceTicket({ ticketCents: 1000, plan: 'UNLIMITED', orgFeeCents: 200 });

      expect(b.totalCents).toBe(1210);
      expect(b.orgFeeCents).toBe(200);
    });

    it('keeps the co-op\'s fee out of the application fee', () => {
      // The application fee is what Stripe moves to MaybeOS. The co-op's own
      // fee is not MaybeOS's money; sweeping it up here would take it.
      const b = priceTicket({ ticketCents: 1000, plan: 'FREE', orgFeeCents: 200 });

      expect(b.applicationFeeCents).toBe(100);
      expect(b.applicationFeeCents).not.toBe(b.platformFeeCents + b.orgFeeCents);
    });

    it('charges no co-op fee when none is set', () => {
      expect(priceTicket({ ticketCents: 1000, plan: 'PLUS' }).orgFeeCents).toBe(0);
    });
  });

  describe('the total always adds up', () => {
    it.each([
      [500, 'FREE', 0],
      [1000, 'PLUS', 150],
      [12345, 'UNLIMITED', 99],
    ] as const)('%d cents on %s with %d org fee', (ticketCents, plan, orgFeeCents) => {
      const b = priceTicket({ ticketCents, plan, orgFeeCents });

      expect(b.totalCents).toBe(b.ticketCents + b.platformFeeCents + b.orgFeeCents);
      expect(Number.isInteger(b.totalCents)).toBe(true);
    });
  });

  describe('refuses nonsense rather than rounding it away', () => {
    it.each([[0], [-100], [10.5]])('rejects a ticket price of %s', (ticketCents) => {
      expect(() => priceTicket({ ticketCents, plan: 'FREE' })).toThrow();
    });

    it('rejects a fractional co-op fee', () => {
      // Money in floats is how a ledger stops adding up.
      expect(() =>
        priceTicket({ ticketCents: 1000, plan: 'FREE', orgFeeCents: 12.5 }),
      ).toThrow();
    });

    it('rejects a negative co-op fee, which would be a discount MaybeOS funds', () => {
      expect(() =>
        priceTicket({ ticketCents: 1000, plan: 'FREE', orgFeeCents: -50 }),
      ).toThrow();
    });
  });

  describe('telling the buyer what the extra is', () => {
    it('names both fees', () => {
      const b = priceTicket({ ticketCents: 1000, plan: 'FREE', orgFeeCents: 200 });

      expect(describeFees(b)).toBe('+ $3.00 in fees ($1.00 MaybeOS, $2.00 venue)');
    });

    it('omits the co-op fee when there is none', () => {
      const b = priceTicket({ ticketCents: 1000, plan: 'UNLIMITED' });

      expect(describeFees(b)).toBe('+ $0.10 in fees ($0.10 MaybeOS)');
    });
  });
});
