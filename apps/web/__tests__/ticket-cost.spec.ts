import { ticketCost, describeFees, money } from '@/lib/fees';

/**
 * The buyer sees the real number before they are sent to Stripe.
 *
 * The API computes the charge and the application fee (D-013); this mirrors it
 * so the button and the Stripe page agree. A button saying $10.00 in front of
 * a checkout saying $10.55 is how a co-op gets accused of hiding fees — and
 * MaybeOS's whole pitch here is that the fee is named.
 */
describe('what a ticket costs the buyer', () => {
  it('adds the FREE-plan fee on top, so a $10 ticket is charged $10.55', () => {
    // The exact figure PAY-04's live test is checking against.
    expect(ticketCost({ ticketCents: 1000, plan: 'FREE' }).totalCents).toBe(1055);
  });

  it('leaves the co-op its full asking price', () => {
    // Fees on top, never taken out — a co-op pricing at $10 receives $10.
    expect(ticketCost({ ticketCents: 1000, plan: 'FREE' }).ticketCents).toBe(1000);
  });

  it('charges each plan its own per-transaction fee', () => {
    expect(ticketCost({ ticketCents: 1000, plan: 'PLUS' }).totalCents).toBe(1030);
    expect(ticketCost({ ticketCents: 1000, plan: 'UNLIMITED' }).totalCents).toBe(1010);
  });

  it('adds the co-op’s own fee as well, and names it separately', () => {
    const cost = ticketCost({ ticketCents: 1000, plan: 'FREE', orgFeeCents: 200 });

    expect(cost.totalCents).toBe(1255);
    expect(describeFees(cost)).toBe('includes $2.55 in fees ($0.55 MaybeOS, $2.00 venue)');
  });

  it('falls back to the FREE fee rather than charging nothing on an unknown plan', () => {
    // Guessing zero would silently stop MaybeOS being paid.
    expect(ticketCost({ ticketCents: 1000, plan: 'MYSTERY' }).platformFeeCents).toBe(55);
  });

  it('formats money to the cent', () => {
    expect(money(1055)).toBe('$10.55');
  });
});
