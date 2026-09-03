import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { BuddyService } from '../../belonging/buddy.service';

/**
 * A tier's service expectation travels as a pair (SRV-01).
 *
 * Minutes with no period is a number over no stretch of time; a period with no
 * minutes is a stretch of time with nothing asked in it. Either alone produces
 * a tier that looks like it asks something and reports nothing — and the
 * failure would surface as a member being told they are short of an
 * expectation nobody can state.
 *
 * The create path is also covered because `createTier` enumerates its fields
 * one by one rather than spreading the DTO, so a new column is silently
 * dropped there unless somebody adds it. Which is exactly the bug this test
 * would have caught.
 */
describe('MemberService — a tier\'s service expectation', () => {
  let service: MemberService;
  let prisma: any;

  const TIER = {
    id: 'tier-1',
    orgId: 'org-1',
    priceMonthly: 2500,
    isPayWhatYouCan: false,
    serviceMinutes: 240,
    servicePeriod: 'MONTH',
  };

  beforeEach(async () => {
    prisma = {
      membershipTier: {
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'tier-1', ...data })),
        findFirst: jest.fn().mockResolvedValue(TIER),
        findUnique: jest.fn().mockResolvedValue(TIER),
        update: jest.fn().mockImplementation(({ data }) => ({ ...TIER, ...data })),
      },
      organization: { update: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        {
          provide: StripeService,
          useValue: { createStripePricesForTier: jest.fn().mockResolvedValue({}) },
        },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: BuddyService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get(MemberService);
  });

  const base = { name: 'Community', priceMonthly: 2500 };

  it('stores an expectation given both halves', async () => {
    await service.createTier('org-1', {
      ...base,
      serviceMinutes: 240,
      servicePeriod: 'MONTH',
    } as never);

    expect(prisma.membershipTier.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceMinutes: 240, servicePeriod: 'MONTH' }),
      }),
    );
  });

  it('refuses minutes with no period', async () => {
    await expect(
      service.createTier('org-1', { ...base, serviceMinutes: 240 } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a period with no minutes', async () => {
    await expect(
      service.createTier('org-1', { ...base, servicePeriod: 'WEEK' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('asks nothing when neither is given, which is every tier today', async () => {
    await service.createTier('org-1', base as never);

    const { data } = prisma.membershipTier.create.mock.calls[0][0];
    expect(data.serviceMinutes).toBeUndefined();
    expect(data.servicePeriod).toBeUndefined();
  });

  it('clears an expectation when both are sent as null', async () => {
    // An omitted field on a PATCH means "leave it alone", so removing an
    // expectation needs an explicit null.
    await service.updateTier('org-1', 'tier-1', {
      serviceMinutes: null,
      servicePeriod: null,
    } as never);

    expect(prisma.membershipTier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceMinutes: null, servicePeriod: null }),
      }),
    );
  });

  it('clears the whole expectation when either half is cleared', async () => {
    // No amount and no period are the same answer: no expectation. Leaving a
    // stray period behind would be a tier that asks for a month of nothing.
    await service.updateTier('org-1', 'tier-1', { serviceMinutes: null } as never);

    expect(prisma.membershipTier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceMinutes: null, servicePeriod: null }),
      }),
    );
  });

  it('refuses one half cleared while the other is set in the same call', async () => {
    // Two contradictory instructions, rather than an omission.
    await expect(
      service.updateTier('org-1', 'tier-1', {
        serviceMinutes: null,
        servicePeriod: 'WEEK',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets an organiser change only the period of an existing expectation', async () => {
    // The bug this catches: without knowing what the tier already holds, this
    // reads as "half an expectation" and a legitimate edit is refused.
    await service.updateTier('org-1', 'tier-1', { servicePeriod: 'WEEK' } as never);

    expect(prisma.membershipTier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceMinutes: 240, servicePeriod: 'WEEK' }),
      }),
    );
  });

  it('lets an organiser change only the amount', async () => {
    await service.updateTier('org-1', 'tier-1', { serviceMinutes: 300 } as never);

    expect(prisma.membershipTier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceMinutes: 300, servicePeriod: 'MONTH' }),
      }),
    );
  });

  it('leaves an existing expectation alone when a price is edited', async () => {
    await service.updateTier('org-1', 'tier-1', { name: 'Community Plus' } as never);

    const { data } = prisma.membershipTier.update.mock.calls[0][0];
    expect('serviceMinutes' in data).toBe(false);
    expect('servicePeriod' in data).toBe(false);
  });
});
