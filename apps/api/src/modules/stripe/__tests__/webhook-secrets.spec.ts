import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { StripeService } from '../stripe.service';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * One URL, two Stripe endpoints, two signing secrets.
 *
 * A Stripe webhook endpoint listens either to the platform's own events or to
 * its connected accounts' — never both, and that is fixed when the endpoint is
 * created. Ticket and room-hire charges are **direct charges on the co-op's
 * account** (D-013), so `checkout.session.completed` fires on the connected
 * account and only a Connect endpoint ever sees it. Both endpoints can point
 * at this same URL, and Stripe signs each with its own secret.
 *
 * Verifying against one secret would accept membership dues and reject every
 * ticket — with a 400, so Stripe retries the same rejection until it gives up,
 * and a member who has paid never gets a ticket. Nothing about that failure
 * looks like a signature problem from the outside: the money moves and the
 * product stays silent.
 */
describe('StripeService — webhook signature secrets', () => {
  const build = async (config: Record<string, string>) => {
    const module = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: ConnectService, useValue: { recordTicketFromSession: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: EmailService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key] ?? '') },
        },
      ],
    }).compile();

    return module.get<StripeService>(StripeService);
  };

  // The Stripe SDK's `webhooks` helper is shared, so a spy left installed
  // leaks its recorded calls into the next test — which is how the third case
  // first "failed" while the code was right.
  afterEach(() => jest.restoreAllMocks());

  /** Every secret is wrong, so the loop is exercised to exhaustion. */
  const reject = (service: StripeService) =>
    service.handleWebhook(Buffer.from('{}'), 't=1,v1=nonsense');

  it('refuses an event when no secret is configured at all', async () => {
    const service = await build({ STRIPE_SECRET_KEY: 'sk_test_x' });
    await expect(reject(service)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tries the Connect secret as well as the platform one', async () => {
    const config = {
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_platform',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
    };
    const service = await build(config);
    const spy = jest.spyOn(
      (service as unknown as { stripe: { webhooks: { constructEvent: jest.Mock } } }).stripe
        .webhooks,
      'constructEvent',
    );

    await expect(reject(service)).rejects.toBeInstanceOf(BadRequestException);

    // Both were attempted — stopping after the platform secret is exactly the
    // bug this exists to prevent.
    const secretsTried = spy.mock.calls.map((call) => call[2]);
    expect(secretsTried).toEqual(['whsec_platform', 'whsec_connect']);
  });

  it('still works with only the platform secret set', async () => {
    // A deployment that has not added the Connect endpoint yet must keep
    // processing dues rather than refusing everything.
    const service = await build({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_platform',
    });
    const spy = jest.spyOn(
      (service as unknown as { stripe: { webhooks: { constructEvent: jest.Mock } } }).stripe
        .webhooks,
      'constructEvent',
    );

    await expect(reject(service)).rejects.toBeInstanceOf(BadRequestException);
    expect(spy.mock.calls.map((call) => call[2])).toEqual(['whsec_platform']);
  });
});
