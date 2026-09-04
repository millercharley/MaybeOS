import { Test, TestingModule } from '@nestjs/testing';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';
import { ConfigService } from '@nestjs/config';

/**
 * The order a co-op's tiers appear in (MEM-13).
 *
 * `sortOrder` has been on the model since it was drawn and every list reads
 * it, but nothing could write it except tier creation, which appends. So the
 * dues page showed tiers in whatever order somebody added them — Charley's had
 * $19.50 above $4 above $10 above $0 — and no way to say otherwise.
 */
describe('MemberService — ordering tiers', () => {
  let service: MemberService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        {
          provide: PrismaService,
          useValue: {
            membershipTier: {
              updateMany: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
            },
            userOrg: { groupBy: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: BuddyService, useValue: {} },
      ],
    }).compile();

    service = module.get<MemberService>(MemberService);
    prisma = module.get(PrismaService);
  });

  it('numbers the tiers by their position in the list', async () => {
    await service.reorderTiers(ORG, ['free', 'four', 'ten', 'sustainer']);

    expect(prisma.membershipTier.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'free', orgId: ORG },
      data: { sortOrder: 0 },
    });
    expect(prisma.membershipTier.updateMany).toHaveBeenNthCalledWith(4, {
      where: { id: 'sustainer', orgId: ORG },
      data: { sortOrder: 3 },
    });
  });

  it('scopes every write to this co-op', async () => {
    // The list of ids comes from a browser. A doctored one must not renumber
    // another co-op's tiers — and a tier is what a member is charged for.
    await service.reorderTiers(ORG, ['a', 'b']);

    for (const call of prisma.membershipTier.updateMany.mock.calls) {
      expect((call[0] as { where: { orgId: string } }).where.orgId).toBe(ORG);
    }
  });

  it('writes the whole order at once', async () => {
    // Moving one tier renumbers its neighbours anyway, and two admins doing
    // that at the same time would leave two tiers claiming one position.
    await service.reorderTiers(ORG, ['a', 'b', 'c']);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all for an empty list', async () => {
    await service.reorderTiers(ORG, []);

    expect(prisma.membershipTier.updateMany).not.toHaveBeenCalled();
  });
});
