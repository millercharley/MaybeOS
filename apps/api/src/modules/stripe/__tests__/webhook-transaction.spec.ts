import { ConnectService } from '../connect.service';

/**
 * A ticket must be recorded on the webhook's own connection.
 *
 * The webhook claim and the work it authorises commit together (D-014), and
 * the runtime allows each Lambda container exactly one database connection
 * (D-018). So a write inside the transaction that reaches for the *ambient*
 * Prisma client asks the pool for a second connection while the transaction
 * holds the only one — and waits.
 *
 * That is what happened to the first real ticket sale on 2026-08-18. The
 * ticket committed on its own connection, the transaction then blew its 5s
 * budget (`5064 ms passed`) and rolled back the claim, Stripe saw a non-2xx
 * and retried, and the retry failed identically. The buyer had a ticket, the
 * co-op had the money, and the webhook sat in a retry loop until Stripe would
 * have given up. Every screen said success.
 *
 * The failure is invisible at the call site — the ticket appears, so the bug
 * looks like it isn't there — which is exactly why it is pinned here.
 */
describe('ConnectService — recording a ticket inside a transaction', () => {
  const session = {
    id: 'cs_test_1',
    currency: 'usd',
    amount_total: 1200,
    payment_intent: 'pi_1',
    customer_details: { email: 'buyer@example.com', name: 'A Buyer' },
    metadata: {
      kind: 'event_ticket',
      eventId: 'event-1',
      userId: 'user-1',
      platformFeeCents: '100',
      orgFeeCents: '145',
    },
  } as never;

  /** Stands in for the transaction client the webhook hands down. */
  const makeTx = () => ({
    ticket: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'ticket-1', buyerEmail: 'buyer@example.com' }),
    },
    rsvp: { upsert: jest.fn().mockResolvedValue({}), create: jest.fn() },
  });

  /** The ambient client. Every call on it here is the bug. */
  const makeAmbient = () => ({
    ticket: { findUnique: jest.fn(), create: jest.fn() },
    rsvp: { upsert: jest.fn(), create: jest.fn() },
  });

  const build = (ambient: ReturnType<typeof makeAmbient>) =>
    new ConnectService(ambient as never, { get: () => 'sk_test_x' } as never, {} as never);

  it('writes the ticket through the transaction it was given', async () => {
    const ambient = makeAmbient();
    const tx = makeTx();

    await build(ambient).recordTicketFromSession(session, tx as never);

    expect(tx.ticket.create).toHaveBeenCalled();
    // The whole defect in one assertion: a create here is a second connection
    // requested while the transaction holds the only one.
    expect(ambient.ticket.create).not.toHaveBeenCalled();
  });

  it('confirms the RSVP through the same transaction', async () => {
    const ambient = makeAmbient();
    const tx = makeTx();

    await build(ambient).recordTicketFromSession(session, tx as never);

    expect(tx.rsvp.upsert).toHaveBeenCalled();
    expect(ambient.rsvp.upsert).not.toHaveBeenCalled();
  });

  it('checks for an existing ticket through the transaction too', async () => {
    // The idempotency read is why a retry did not double-sell during the
    // incident; it has to see the transaction's own view.
    const ambient = makeAmbient();
    const tx = makeTx();

    await build(ambient).recordTicketFromSession(session, tx as never);

    expect(tx.ticket.findUnique).toHaveBeenCalled();
    expect(ambient.ticket.findUnique).not.toHaveBeenCalled();
  });

  it('still works on the ambient client when called outside a transaction', async () => {
    const ambient = makeAmbient();
    ambient.ticket.findUnique.mockResolvedValue(null);
    ambient.ticket.create.mockResolvedValue({ id: 't', buyerEmail: 'b@example.com' });

    await build(ambient).recordTicketFromSession(session);

    expect(ambient.ticket.create).toHaveBeenCalled();
  });

  it('ignores a session that is not a ticket', async () => {
    const ambient = makeAmbient();
    const tx = makeTx();

    const result = await build(ambient).recordTicketFromSession(
      { ...(session as object), metadata: { kind: 'room_booking' } } as never,
      tx as never,
    );

    expect(result).toBeNull();
    expect(tx.ticket.create).not.toHaveBeenCalled();
  });
});
