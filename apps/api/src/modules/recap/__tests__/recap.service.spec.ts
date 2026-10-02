import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RecapService } from '../recap.service';
import { duesPaymentFrom } from '../../stripe/dues-ledger';

/**
 * The monthly recap (RCP-01).
 *
 * The failures worth pinning are the quiet ones: a recap that reports a
 * month the co-op does not live in, one that goes out twice, one that goes
 * out at all when nothing happened, and a money figure that silently means
 * something other than what it says.
 */

const ORG = {
  id: 'org-1',
  name: 'MaybeItsFate',
  slug: 'maybeitsfate',
  plan: 'PLUS',
  recapShowMoney: true,
  // Five hours behind UTC, which is what makes the month boundary a real
  // question rather than a formality.
  timezone: 'America/New_York',
  recapDraftHour: 8,
  duesBackfilledAt: new Date('2026-09-01T00:00:00Z'),
};

/** 1 October 2026, 08:30 in New York — the hour a co-op on the default is due. */
const DUE = new Date('2026-10-01T12:30:00Z');

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    organization: {
      findMany: jest.fn().mockResolvedValue([ORG]),
      findUnique: jest.fn().mockResolvedValue(ORG),
      update: jest.fn().mockResolvedValue({}),
    },
    monthlyRecap: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'recap-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    userOrg: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    event: { findMany: jest.fn().mockResolvedValue([]) },
    attendance: { groupBy: jest.fn().mockResolvedValue([]) },
    rsvp: { findMany: jest.fn().mockResolvedValue([]) },
    duesPayment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0 } }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    ticket: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0 } }) },
    booking: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0 } }) },
    ...overrides,
  };

  const email = { sendRecap: jest.fn(), sendRecapReady: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('https://maybeos.org') };
  const impact = { getSignals: jest.fn().mockResolvedValue({ categories: [] }) };
  const service = { contribution: jest.fn().mockResolvedValue(null) };
  const stripe = { backfillDues: jest.fn().mockResolvedValue({ invoices: 0, recorded: 0, failed: 0 }) };
  const composer = { composeRecap: jest.fn().mockResolvedValue({ outcome: 'gave-up', reason: 'no key' }) };

  const recap = new RecapService(
    prisma as never,
    email as never,
    config as never,
    impact as never,
    service as never,
    stripe as never,
    composer as never,
  );

  return { recap, prisma, email, stripe, composer, impact };
}

describe('which month it is about', () => {
  it("uses the co-op's own calendar, not UTC", async () => {
    const { recap, prisma } = build();

    await recap.figuresFor('org-1', DUE);

    const joinedQuery = prisma.userOrg.findMany.mock.calls[0][0].where.memberSince;
    // September in New York starts at 04:00 UTC on the 1st. Taken as UTC, the
    // month would start five hours early and swallow the evening of 31
    // August — the kind of wrong that looks plausible and files the event
    // everybody remembers under the wrong month.
    expect(joinedQuery.gte.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(joinedQuery.lt.toISOString()).toBe('2026-10-01T04:00:00.000Z');
  });

  it('names the month the way a member would say it', async () => {
    const { recap } = build();
    const figures = await recap.figuresFor('org-1', DUE);

    expect(figures.monthLabel).toBe('September 2026');
  });
});

describe('what it counts', () => {
  it('counts members the way the rest of the product does, excluding guests', async () => {
    const { recap, prisma } = build();

    await recap.figuresFor('org-1', DUE);

    // ImpactOS counts memberships with no role filter, so a co-op with guests
    // has two different member counts in the product. The recap uses the one
    // that matches the dashboard and how Plus is billed.
    expect(prisma.userOrg.count.mock.calls[0][0].where.role).toEqual({
      in: ['ADMIN', 'STAFF', 'MEMBER'],
    });
  });

  it('reports who came and who meant to come as separate figures', async () => {
    const { recap } = build({
      attendance: { groupBy: jest.fn().mockResolvedValue([{ eventId: 'e1', _count: { _all: 40 } }]) },
      rsvp: { findMany: jest.fn().mockResolvedValue([{ plusOnes: 1 }, { plusOnes: 0 }]) },
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]) },
    });

    const figures = await recap.figuresFor('org-1', DUE);

    expect(figures.events).toEqual({
      hosted: 2,
      checkedIn: 40,
      // One of two events had anybody at the door, which is the number that
      // stops 40 reading as the month's attendance.
      eventsWithDoor: 1,
      expected: 3,
    });
  });

  it('adds up money as dues, tickets and room hire — and nothing it cannot see', async () => {
    const { recap } = build({
      duesPayment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 120000 } }),
        findFirst: jest.fn().mockResolvedValue({ paidAt: new Date('2026-01-04T00:00:00Z') }),
      },
      ticket: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 45000 } }) },
      booking: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 5000 } }) },
    });

    const figures = await recap.figuresFor('org-1', DUE);

    expect(figures.money.month.totalCents).toBe(170000);
    // Where the dues record starts, so a first recap cannot imply a full year.
    expect(figures.money.duesRecordedSince).toBe('2026-01-04T00:00:00.000Z');
  });

  it('leaves out an impact measure too few people answered', async () => {
    const { recap } = build();
    const { impact } = build();
    impact.getSignals.mockResolvedValue({
      categories: [
        { category: 'belonging', average: 4.1, respondents: 23 },
        // Suppressed upstream: fewer than five people, so no average at all.
        { category: 'loneliness', average: null, respondents: 3 },
      ],
    });

    const withSignals = new RecapService(
      (build().prisma as never),
      { sendRecap: jest.fn(), sendRecapReady: jest.fn() } as never,
      { get: () => 'https://maybeos.org' } as never,
      impact as never,
      { contribution: jest.fn().mockResolvedValue(null) } as never,
      { backfillDues: jest.fn() } as never,
      { composeRecap: jest.fn() } as never,
    );

    const figures = await withSignals.figuresFor('org-1', DUE);

    expect(figures.impact).toEqual([{ category: 'belonging', average: 4.1, respondents: 23 }]);
  });
});

describe('drafting on the 1st', () => {
  it('drafts for a co-op whose own clock has reached the hour', async () => {
    const { recap, prisma } = build({
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
    });

    const result = await recap.draftDue(DUE);

    expect(result.processed).toBe(1);
    expect(prisma.monthlyRecap.create).toHaveBeenCalled();
  });

  it('does nothing on the 2nd', async () => {
    const { recap, prisma } = build({
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
    });

    expect((await recap.draftDue(new Date('2026-10-02T12:30:00Z'))).processed).toBe(0);
    expect(prisma.monthlyRecap.create).not.toHaveBeenCalled();
  });

  it('does nothing at any other hour of the 1st', async () => {
    const { recap, prisma } = build({
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
    });

    // 13:30 UTC is 09:30 in New York; the co-op asked for 8.
    expect((await recap.draftDue(new Date('2026-10-01T13:30:00Z'))).processed).toBe(0);
    expect(prisma.monthlyRecap.create).not.toHaveBeenCalled();
  });

  it('sends no letter about a month in which nothing happened', async () => {
    const { recap, prisma, email } = build();

    const result = await recap.draftDue(DUE);

    // Six zeroes to a whole community is worse than silence, and the recap
    // exists to make membership feel worthwhile.
    expect(result.processed).toBe(0);
    expect(prisma.monthlyRecap.create).not.toHaveBeenCalled();
    expect(email.sendRecapReady).not.toHaveBeenCalled();
  });

  it('drafts once, however many times the scheduler runs in that hour', async () => {
    const { recap, prisma } = build({
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
      monthlyRecap: {
        findUnique: jest.fn().mockResolvedValue({ id: 'already-there' }),
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    });

    await recap.draftDue(DUE);

    expect(prisma.monthlyRecap.create).not.toHaveBeenCalled();
  });

  it('tells the organisers rather than the members', async () => {
    const { recap, prisma, email } = build({
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
    });
    // Two different reads go through `findMany`: the month's arrivals (which
    // ask for `createdAt`) and the organisers to notify. Answering both with
    // the same rows would hand the arrival split a row with no date.
    prisma.userOrg.findMany.mockImplementation(async (args: any) =>
      args?.select?.createdAt ? [] : [{ user: { email: 'admin@example.com', name: 'Mo' } }],
    );

    await recap.draftDue(DUE);

    expect(email.sendRecapReady).toHaveBeenCalledTimes(1);
    expect(email.sendRecap).not.toHaveBeenCalled();
    expect(email.sendRecapReady.mock.calls[0][1].reviewUrl).toBe(
      'https://maybeos.org/admin/maybeitsfate/recap',
    );
  });

  it('reads dues out of Stripe once, so a first recap is not a year of zeroes', async () => {
    const { recap, stripe } = build({
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
      organization: {
        findMany: jest.fn().mockResolvedValue([ORG]),
        findUnique: jest.fn().mockResolvedValue({ ...ORG, duesBackfilledAt: null }),
        update: jest.fn(),
      },
    });

    await recap.draftDue(DUE);

    expect(stripe.backfillDues).toHaveBeenCalledWith('org-1', expect.any(Date));
  });

  it('still drafts when Stripe cannot be read', async () => {
    const { recap, prisma } = build({
      event: { findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]) },
      organization: {
        findMany: jest.fn().mockResolvedValue([ORG]),
        findUnique: jest.fn().mockResolvedValue({ ...ORG, duesBackfilledAt: null }),
        update: jest.fn(),
      },
    });
    // A Stripe outage must not cost the co-op its recap: everything MaybeOS
    // recorded itself is still true.
    const { stripe } = build();
    stripe.backfillDues.mockRejectedValue(new Error('Stripe is down'));

    await expect(recap.draftDue(DUE)).resolves.toBeDefined();
    expect(prisma.monthlyRecap.create).toHaveBeenCalled();
  });
});

describe('sending', () => {
  const DRAFT = {
    id: 'recap-1',
    orgId: 'org-1',
    status: 'DRAFT',
    note: 'Thanks for a good month.',
    composed: null,
    figures: { monthLabel: 'September 2026' },
  };

  it('marks it sent before handing any email over, because failures are swallowed', async () => {
    const { recap, prisma, email } = build({
      monthlyRecap: {
        findFirst: jest.fn().mockResolvedValue(DRAFT),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    });
    prisma.userOrg.findMany.mockResolvedValue([
      { id: 'm1', user: { email: 'a@example.com', name: 'A' } },
    ]);

    const order: string[] = [];
    prisma.monthlyRecap.update.mockImplementation(async () => {
      order.push('marked');
      return {};
    });
    email.sendRecap.mockImplementation(async () => {
      order.push('sent');
    });

    await recap.send('org-1', 'recap-1', 'user-1');

    expect(order).toEqual(['marked', 'sent']);
  });

  it('refuses to send the same recap twice', async () => {
    const { recap } = build({
      monthlyRecap: {
        findFirst: jest.fn().mockResolvedValue({ ...DRAFT, status: 'SENT' }),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    });

    await expect(recap.send('org-1', 'recap-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('leaves out anyone who unsubscribed, from the recap or from the co-op', async () => {
    const { recap, prisma } = build({
      monthlyRecap: {
        findFirst: jest.fn().mockResolvedValue(DRAFT),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    });
    prisma.userOrg.findMany.mockResolvedValue([]);

    await recap.send('org-1', 'recap-1', 'user-1');

    const where = prisma.userOrg.findMany.mock.calls[0][0].where;
    expect(where.recapEmails).toBe(true);
    expect(where.role).toEqual({ in: ['ADMIN', 'STAFF', 'MEMBER'] });

    // Written `{ not: false }` this silently excluded every member who had
    // never been asked — `NULL <> false` is NULL in SQL, not true — which on
    // a real co-op is almost everybody, and looked exactly like a month with
    // nothing to say. Found by sending to a co-op of eight and reaching one.
    expect(where.emailOptIn).toBeUndefined();
    expect(where.OR).toEqual([{ emailOptIn: null }, { emailOptIn: true }]);
  });

  it('refuses outright on a plan that does not include it', async () => {
    const { recap, prisma } = build();
    prisma.organization.findUnique.mockResolvedValue({ ...ORG, plan: 'FREE' });

    await expect(recap.send('org-1', 'recap-1', 'user-1')).rejects.toThrow(ForbiddenException);
  });

  it('will not let an organiser edit the note after it has gone out', async () => {
    const { recap } = build({
      monthlyRecap: {
        findFirst: jest.fn().mockResolvedValue({ id: 'recap-1', status: 'SENT' }),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    });

    await expect(recap.setNote('org-1', 'recap-1', 'late edit')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('reading a dues invoice', () => {
  const invoice = (over: Record<string, unknown> = {}) =>
    ({
      id: 'in_1',
      status: 'paid',
      amount_paid: 2500,
      total: 2700,
      currency: 'usd',
      created: 1_759_000_000,
      status_transitions: { paid_at: 1_759_100_000 },
      parent: { subscription_details: { subscription: 'sub_1' } },
      application_fee_amount: 200,
      customer: 'cus_1',
      ...over,
    }) as never;

  it('records what actually moved, not what was asked for', () => {
    const payment = duesPaymentFrom(invoice());

    // `total` is the ask; `amount_paid` is the money. They differ whenever a
    // credit, proration or discount is involved, and taking the wrong one is
    // wrong by the same amount every month with nothing failing.
    expect(payment?.amountCents).toBe(2500);
    expect(payment?.feeCents).toBe(200);
  });

  it('dates it by when it was paid, not when it was written', () => {
    const payment = duesPaymentFrom(invoice());

    expect(payment?.paidAt).toEqual(new Date(1_759_100_000 * 1000));
  });

  it('ignores an invoice that was never paid', () => {
    expect(duesPaymentFrom(invoice({ status: 'open' }))).toBeNull();
  });

  it('ignores a zero invoice, which is a trial and not revenue', () => {
    expect(duesPaymentFrom(invoice({ amount_paid: 0 }))).toBeNull();
  });

  it('ignores an invoice with no subscription, which is not dues', () => {
    expect(duesPaymentFrom(invoice({ parent: null }))).toBeNull();
  });
});
