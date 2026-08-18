import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { ConnectService } from '../connect.service';
import { PrismaService } from '../../../config/prisma.service';
import { CalendarService } from '../../calendar/calendar.service';

/**
 * Reading a connected account's status through the right API (PAY-04).
 *
 * MaybeOS can end up with two kinds of connected account. It *creates* one
 * using Accounts v2; it *links* one a co-op already has over OAuth, and that is
 * always a v1 Standard account, because it existed before MaybeOS did.
 *
 * On 2026-08-18 the first real co-op linked its own account. Everything worked
 * — the OAuth handshake, the token exchange, the stored account id — and then
 * the setup screen showed `v1 Accounts cannot be used in v2 Account APIs`,
 * because the status read asked a v1 account a v2 question. The account was
 * live and taking money the whole time; only the question was wrong.
 *
 * Stripe's explanation was that a linked account becomes v2-compatible within
 * ten minutes. It had not after twenty, which is why these tests pin the
 * behaviour to the account's generation rather than to a delay: a setup screen
 * that depends on an unbounded wait is a setup screen that is sometimes broken.
 *
 * What each test prevents:
 *   1. the original incident — a v1 account read through v2
 *   2. the mirror of it — a v2 account read through v1, which would report a
 *      co-op as unable to take money when it can
 *   3. a row whose generation was never recorded silently taking the v2 path
 *   4. Stripe's internal error reaching an organiser who can do nothing with it
 */
describe('ConnectService — which Accounts API to ask', () => {
  let service: ConnectService;
  let prisma: { organization: Record<string, jest.Mock> };
  let v1Retrieve: jest.Mock;
  let v2Retrieve: jest.Mock;
  let accountLinksCreate: jest.Mock;

  const org = (over: Record<string, unknown> = {}) => ({
    id: 'org-1',
    name: 'Acme Organization',
    stripeAccountId: 'acct_existing',
    stripeAccountApi: 'V1',
    stripeChargesEnabled: false,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 'sk_test_x' } },
        {
          provide: CalendarService,
          useValue: { syncBooking: jest.fn().mockResolvedValue({ synced: false }) },
        },
      ],
    }).compile();

    service = module.get<ConnectService>(ConnectService);

    // A v1 Standard account that is fully live — the shape MaybeItsFate's real
    // account returned from /v1/accounts on the day this broke.
    v1Retrieve = jest.fn().mockResolvedValue({
      id: 'acct_existing',
      type: 'standard',
      charges_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [] },
    });

    // The v2 endpoint refuses a v1 account, exactly as production did.
    v2Retrieve = jest.fn().mockRejectedValue(
      new Error('v1 Accounts cannot be used in v2 Account APIs.'),
    );

    accountLinksCreate = jest.fn().mockResolvedValue({ url: 'https://stripe.test/onboard' });

    (service as unknown as { stripe: unknown }).stripe = {
      accounts: { retrieve: v1Retrieve },
      v2: { core: { accounts: { retrieve: v2Retrieve }, accountLinks: { create: accountLinksCreate } } },
    } as never;
  });

  it('reads a linked account through v1, which is the incident this fixes', async () => {
    prisma.organization.findUnique.mockResolvedValue(org());

    const status = await service.refreshAccountStatus('org-1');

    expect(v1Retrieve).toHaveBeenCalledWith('acct_existing');
    expect(v2Retrieve).not.toHaveBeenCalled();
    expect(status).toMatchObject({ connected: true, chargesEnabled: true, detailsSubmitted: true });
  });

  it('persists that the co-op can take money, so selling is not gated on a re-read', async () => {
    prisma.organization.findUnique.mockResolvedValue(org({ stripeChargesEnabled: false }));

    await service.refreshAccountStatus('org-1');

    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stripeChargesEnabled: true } }),
    );
  });

  it('reads an account MaybeOS created through v2, not v1', async () => {
    prisma.organization.findUnique.mockResolvedValue(
      org({ stripeAccountApi: 'V2', stripeAccountId: 'acct_created' }),
    );
    v2Retrieve.mockResolvedValue({
      id: 'acct_created',
      configuration: { merchant: { capabilities: { card_payments: { status: 'active' } } } },
      requirements: { entries: [] },
    });

    const status = await service.refreshAccountStatus('org-1');

    expect(v2Retrieve).toHaveBeenCalled();
    expect(v1Retrieve).not.toHaveBeenCalled();
    expect(status).toMatchObject({ chargesEnabled: true });
  });

  it('treats an unrecorded generation as v1 rather than guessing v2', async () => {
    // Belt and braces for a row the backfill missed: every account connected in
    // production to date came through OAuth, so v1 is the safe assumption. The
    // wrong guess here is the one that reproduces the outage.
    prisma.organization.findUnique.mockResolvedValue(org({ stripeAccountApi: null }));

    await service.refreshAccountStatus('org-1');

    expect(v1Retrieve).toHaveBeenCalled();
    expect(v2Retrieve).not.toHaveBeenCalled();
  });

  it('reports no account as disconnected without calling Stripe at all', async () => {
    prisma.organization.findUnique.mockResolvedValue(
      org({ stripeAccountId: null, stripeAccountApi: null }),
    );

    const status = await service.refreshAccountStatus('org-1');

    expect(status).toEqual({ connected: false, chargesEnabled: false, detailsSubmitted: false });
    expect(v1Retrieve).not.toHaveBeenCalled();
    expect(v2Retrieve).not.toHaveBeenCalled();
  });

  it('refuses v2 onboarding for a linked account instead of leaking Stripe’s error', async () => {
    // The co-op onboarded with Stripe directly, years ago. Forwarding
    // "v1 Accounts cannot be used in v2 Account APIs" to an organiser tells
    // them nothing they can act on.
    prisma.organization.findUnique.mockResolvedValue(org());

    await expect(
      service.createOnboardingLink('org-1', 'https://maybeos.org/return', 'https://maybeos.org/refresh'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(accountLinksCreate).not.toHaveBeenCalled();
  });
});
