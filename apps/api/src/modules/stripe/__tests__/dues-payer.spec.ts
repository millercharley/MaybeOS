import { payerFrom } from '../dues-ledger';

/**
 * A dues payment remembers who made it (PAY-10).
 *
 * `dues_payments."userOrgId"` is ON DELETE SET NULL, so removing a member
 * detaches their payments. Found on 2026-10-02 twenty minutes after the
 * removal shipped: a paying test member was removed and their $19.50 stayed
 * in the ledger with nobody attached to it. The co-op's totals were never at
 * risk — those read `orgId` — but *who paid* was gone, which is the half you
 * need when somebody asks for a receipt.
 *
 * So the payer travels on the payment. These values are written once, at the
 * moment the money moves, and are never refreshed afterwards: a payment is a
 * statement about a day, like a recap's frozen figures.
 */

const invoice = (over: Partial<{ invoiceName: string | null; invoiceEmail: string | null }> = {}) => ({
  invoiceName: 'Billed Name',
  invoiceEmail: 'billed@example.com',
  ...over,
});

describe('who a payment records as its payer', () => {
  it('prefers the member MaybeOS knows', () => {
    // An organiser reading this later recognises the member, not whatever
    // name the card was issued in.
    expect(payerFrom({ name: 'Ada Lovelace', email: 'ada@example.com' }, invoice())).toEqual({
      payerName: 'Ada Lovelace',
      payerEmail: 'ada@example.com',
    });
  });

  it('falls back to the invoice when there is no membership', () => {
    // The adopted-subscription case: MaybeOS never issued it, so Stripe is
    // the only thing that knows who paid — and it is also the case where
    // "who was this?" is hardest to answer later.
    expect(payerFrom(null, invoice())).toEqual({
      payerName: 'Billed Name',
      payerEmail: 'billed@example.com',
    });
    expect(payerFrom(undefined, invoice())).toEqual({
      payerName: 'Billed Name',
      payerEmail: 'billed@example.com',
    });
  });

  it('fills each field from wherever it can', () => {
    // An imported member often has an address and no name.
    expect(payerFrom({ name: null, email: 'ada@example.com' }, invoice())).toEqual({
      payerName: 'Billed Name',
      payerEmail: 'ada@example.com',
    });
  });

  it('treats a blank as missing rather than as an answer', () => {
    expect(payerFrom({ name: '   ', email: '' }, invoice())).toEqual({
      payerName: 'Billed Name',
      payerEmail: 'billed@example.com',
    });
  });

  it('writes nothing rather than a placeholder when nobody knows', () => {
    // "Unknown" in this column is indistinguishable from somebody actually
    // called that. A blank is at least honest about being blank.
    expect(payerFrom(null, invoice({ invoiceName: null, invoiceEmail: null }))).toEqual({
      payerName: null,
      payerEmail: null,
    });
  });

  it('trims what a spreadsheet or a card form left behind', () => {
    expect(payerFrom({ name: ' Ada ', email: ' ada@example.com ' }, invoice())).toEqual({
      payerName: 'Ada',
      payerEmail: 'ada@example.com',
    });
  });
});
