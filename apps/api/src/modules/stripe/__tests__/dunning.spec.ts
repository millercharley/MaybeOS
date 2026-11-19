import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../../common/testing/source-scan';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeService } from '../stripe.service';
import { TicketPassService } from '../../events/ticket-pass.service';
import { ConnectService } from '../connect.service';
import { EmailService } from '../../email/email.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * A member whose dues payment fails is told so (PAY-12).
 *
 * Charley's board, as a must: "A member whose dues payment fails is never
 * told." The card blamed Stripe — the Connect endpoint does not subscribe to
 * `invoice.payment_failed`, and member dues live on the co-op's connected
 * account, so the handler never runs.
 *
 * That is true and it was not the whole of it. `EmailService.sendDunning`
 * had been written, templated and left with **no callers anywhere**, and the
 * handler ended with a log line saying "dunning email should be queued" and
 * a note blaming a circular dependency that no longer existed. Subscribing
 * the endpoint would have delivered that log line to nobody.
 *
 * So the test that matters is not that the template exists. It is that
 * something calls it.
 */
describe('telling a member their dues payment failed', () => {
  let service: StripeService;
  let email: { sendDunning: jest.Mock };
  let prisma: { userOrg: { findFirst: jest.Mock } };

  const failure = (subscription: unknown = 'sub_123') =>
    ({
      id: 'evt_1',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', parent: { subscription_details: { subscription } } } },
    }) as unknown as Stripe.Event;

  beforeEach(async () => {
    email = { sendDunning: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      userOrg: {
        findFirst: jest.fn().mockResolvedValue({
          user: { name: 'Alex Rivera', email: 'alex@example.com' },
          org: {
            name: 'Sunrise Community',
            slug: 'sunrise',
            replyToEmail: 'hello@sunrise.coop',
          },
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: TicketPassService, useValue: { confirm: jest.fn() } },
        { provide: ConnectService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get(StripeService);
  });

  /** The private after-commit step, called as `handleWebhook` calls it. */
  const tell = (event: Stripe.Event) =>
    (service as unknown as {
      tellAboutFailedDuesIfAny(e: Stripe.Event): Promise<void>;
    }).tellAboutFailedDuesIfAny(event);

  it('writes to the member, naming the co-op they pay', async () => {
    await tell(failure());

    expect(email.sendDunning).toHaveBeenCalledWith(
      'alex@example.com',
      'Alex Rivera',
      'Sunrise Community',
      'https://maybeos.org/member/sunrise/billing',
      'hello@sunrise.coop',
    );
  });

  it('sends a reply to the co-op, not into a noreply address (EML-03)', async () => {
    /*
      Among the likeliest emails in the product to be replied to — "my card
      changed, can you help?" — and the person who can help is an organiser
      at the co-op.
    */
    await tell(failure());

    expect(email.sendDunning.mock.calls[0][4]).toBe('hello@sunrise.coop');
  });

  it('falls back when the co-op has set no reply address', async () => {
    prisma.userOrg.findFirst.mockResolvedValue({
      user: { name: 'Alex Rivera', email: 'alex@example.com' },
      org: { name: 'Sunrise Community', slug: 'sunrise', replyToEmail: null },
    });

    await tell(failure());

    expect(email.sendDunning.mock.calls[0][4]).toBeNull();
  });

  it('links the member’s own billing page, not a Stripe portal session', async () => {
    /*
      A portal session is short-lived and single-use. An email that sits in
      an inbox for two days would carry a dead link; the app page needs a
      sign-in, which is what everything inside MaybeOS requires.
    */
    await tell(failure());

    const [, , , url] = email.sendDunning.mock.calls[0];
    expect(url).toMatch(/\/member\/sunrise\/billing$/);
    expect(url).not.toMatch(/billing\.stripe\.com|stripe\.com/);
  });

  it('reads the subscription the way Stripe sends it today', async () => {
    // `invoice.subscription` moved to `parent.subscription_details` between
    // acacia and dahlia, and reading the old path silently broke dunning
    // once already. Shared with the ledger rather than copied.
    await tell(failure({ id: 'sub_object' }));

    expect(prisma.userOrg.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeSubscriptionId: 'sub_object' },
      }),
    );
  });

  it('ignores every other kind of event', async () => {
    await tell({ ...failure(), type: 'invoice.paid' } as unknown as Stripe.Event);

    expect(prisma.userOrg.findFirst).not.toHaveBeenCalled();
    expect(email.sendDunning).not.toHaveBeenCalled();
  });

  it('says nothing when the invoice names no subscription', async () => {
    // `null`, not `undefined` — the helper's default parameter would hand
    // back a subscription and quietly test the opposite thing.
    await tell(failure(null));

    expect(email.sendDunning).not.toHaveBeenCalled();
  });

  it('says nothing when no membership holds that subscription', async () => {
    // A co-op's own MaybeOS plan fails through here too, and is not a member.
    prisma.userOrg.findFirst.mockResolvedValue(null);

    await tell(failure());

    expect(email.sendDunning).not.toHaveBeenCalled();
  });

  it('does not throw when the send fails', async () => {
    /*
      Same rule as the ticket confirmation beside it: the membership is
      already PAST_DUE and Stripe must be told we got the event. An
      exception escaping here turns a recorded failure into a retry loop,
      and the member still has not heard.
    */
    email.sendDunning.mockRejectedValue(new Error('postmark is down'));

    await expect(tell(failure())).resolves.toBeUndefined();
  });

  it('does not throw when the member cannot be read', async () => {
    prisma.userOrg.findFirst.mockRejectedValue(new Error('database went away'));

    await expect(tell(failure())).resolves.toBeUndefined();
  });
});

describe('the handler itself', () => {
  /*
    Comments stripped. This file explains the bug it fixes by quoting the
    line that caused it — "For MVP we log the intent here" — so a scan over
    raw source would match the explanation and call the fix the defect.
  */
  const source = stripComments(
    readFileSync(join(__dirname, '..', 'stripe.service.ts'), 'utf8'),
  );

  it('sends after the transaction, never inside it', () => {
    /*
      The transaction holds the runtime's only connection on a 20s budget
      (D-018), and the first real ticket sale already missed a 5s one by
      64ms. A Postmark call inside it is how a committed write gets rolled
      back by a third party being slow.
    */
    const handler = source.slice(
      source.indexOf('private async handleInvoicePaymentFailed'),
      source.indexOf('// Subscription Sync'),
    );

    expect(handler).not.toMatch(/sendDunning|this\.email/);
    expect(source).toMatch(/await this\.tellAboutFailedDuesIfAny\(event\);/);
  });

  it('still marks the membership past due', () => {
    const handler = source.slice(
      source.indexOf('private async handleInvoicePaymentFailed'),
      source.indexOf('// Subscription Sync'),
    );

    expect(handler).toMatch(/subscriptionStatus: 'PAST_DUE'/);
  });

  it('no longer claims a circular dependency stops it', () => {
    // It said "To avoid a circular dependency, the controller or an event
    // emitter should handle email dispatch. For MVP we log the intent here."
    // StripeService already depended on TicketPassService, which depends on
    // EmailService, so there was no cycle — and the MVP had shipped.
    expect(source).not.toMatch(/dunning email should be queued/);
    expect(source).not.toMatch(/For MVP we log the intent/);
  });
});

/**
 * The whole way through, from a signed body to the send.
 *
 * Everything above drives `tellAboutFailedDuesIfAny` directly, and the source
 * scan below only reads where the call sits in the file. Neither executes the
 * seam that actually carries a real event: signature verification, the
 * dispatch switch, the claim transaction, and then the after-commit step with
 * the same `event` object the switch saw.
 *
 * That seam is where this bug lived for months — the handler ran, marked the
 * membership PAST_DUE, and stopped. So it is worth one test that starts where
 * Stripe starts: a payload and a signature.
 *
 * Written after subscribing the live Connect endpoint to
 * `invoice.payment_failed` on 2026-11-19, because a live event cannot be
 * fabricated to prove this and the dashboard's test webhook names a
 * subscription no membership holds.
 */
describe('a signed invoice.payment_failed, end to end', () => {
  const SECRET = 'whsec_test_secret_for_signing';

  let service: StripeService;
  let email: { sendDunning: jest.Mock };
  let update: jest.Mock;
  let created: jest.Mock;

  const membership = {
    id: 'uo_1',
    userId: 'usr_1',
    orgId: 'org_1',
    user: { name: 'Alex Rivera', email: 'alex@example.com' },
    org: { name: 'Sunrise Community', slug: 'sunrise', replyToEmail: 'hello@sunrise.coop' },
  };

  beforeEach(async () => {
    email = { sendDunning: jest.fn().mockResolvedValue(undefined) };
    update = jest.fn().mockResolvedValue(membership);
    created = jest.fn().mockResolvedValue({ id: 'evt_e2e' });

    const findFirst = jest.fn().mockResolvedValue(membership);
    const tx = { webhookEvent: { create: created }, userOrg: { findFirst, update } };

    const prisma = {
      // Runs the callback, as an interactive transaction does. The commit
      // boundary this test cares about is "the callback returned".
      $transaction: jest.fn(async (fn: (c: typeof tx) => Promise<void>) => fn(tx)),
      userOrg: { findFirst },
    };

    const config = {
      get: (key: string) =>
        key === 'STRIPE_WEBHOOK_SECRET' ? SECRET
        : key === 'APP_URL' ? 'https://maybeos.org'
        : undefined,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: TicketPassService, useValue: { confirm: jest.fn() } },
        { provide: ConnectService, useValue: {} },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(StripeService);
  });

  /** The shape Stripe sends on dahlia, which is not where acacia put it. */
  const body = JSON.stringify({
    id: 'evt_e2e',
    object: 'event',
    type: 'invoice.payment_failed',
    account: 'acct_coop',
    data: {
      object: {
        id: 'in_e2e',
        object: 'invoice',
        parent: { subscription_details: { subscription: 'sub_e2e' } },
      },
    },
  });

  const signed = () =>
    service.handleWebhook(
      Buffer.from(body),
      Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }),
    );

  it('reaches the member, starting from a payload and a signature', async () => {
    await expect(signed()).resolves.toEqual({ received: true });

    expect(email.sendDunning).toHaveBeenCalledWith(
      'alex@example.com',
      'Alex Rivera',
      'Sunrise Community',
      'https://maybeos.org/member/sunrise/billing',
      'hello@sunrise.coop',
    );
  });

  it('marks the membership past due and claims the event too', async () => {
    await signed();

    expect(update).toHaveBeenCalledWith({
      where: { id: 'uo_1' },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
    expect(created).toHaveBeenCalledWith({
      data: { id: 'evt_e2e', source: 'stripe' },
    });
  });

  it('sends only after the transaction has returned', async () => {
    /*
      The rule EVT-46 wrote down and PAY-12 inherited: a Postmark call inside
      the claim's transaction risks a committed write being rolled back by a
      third party being slow. Asserted by execution here rather than by
      reading the file — if the call is ever moved inside, this fails.
    */
    let sentDuringTransaction: boolean | null = null;
    let open = false;

    email.sendDunning.mockImplementation(async () => {
      sentDuringTransaction = open;
    });

    const prisma = service as unknown as {
      prisma: { $transaction: jest.Mock };
    };
    const original = prisma.prisma.$transaction;
    prisma.prisma.$transaction = jest.fn(async (fn: (c: unknown) => Promise<void>) => {
      open = true;
      try {
        return await original(fn);
      } finally {
        open = false;
      }
    });

    await signed();

    // Not vacuous: `false` would also be the answer if the override never
    // ran and `open` stayed false throughout. The wrapper must have been
    // entered, and the send must have happened.
    expect(prisma.prisma.$transaction).toHaveBeenCalled();
    expect(email.sendDunning).toHaveBeenCalled();
    expect(sentDuringTransaction).toBe(false);
  });

  it('refuses a body whose signature does not match', async () => {
    // The same payload, signed with something else: nothing is claimed and
    // nobody is written to.
    await expect(
      service.handleWebhook(
        Buffer.from(body),
        Stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_wrong' }),
      ),
    ).rejects.toThrow();

    expect(created).not.toHaveBeenCalled();
    expect(email.sendDunning).not.toHaveBeenCalled();
  });
});
