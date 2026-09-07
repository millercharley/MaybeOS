import { Test, TestingModule } from '@nestjs/testing';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';
import { ConfigService } from '@nestjs/config';
import { PUBLIC_TIER_SELECT } from '../tier-view';

/**
 * The badge on a tier's card (MEM-16).
 *
 * The join page hardcoded it: whichever tier came second was drawn with the
 * emphasised border and labelled "Most Popular". On MaybeItsFate that was the
 * $10 Member, and it was not true — MaybeOS was making a claim about a co-op's
 * membership that nobody at the co-op had made. It is the co-op's claim.
 */
describe('MemberService — the tier highlight', () => {
  let service: MemberService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      membershipTier: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tier-1',
          orgId: 'org-1',
          priceMonthly: 1950,
          isPayWhatYouCan: false,
          stripePriceIdMonthly: 'price_1',
        }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'tier-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'tier-new', ...data })),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 2 } }),
      },
      organization: { update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: StripeService, useValue: { createStripePricesForTier: jest.fn() } },
        { provide: StorageService, useValue: {} },
        { provide: BuddyService, useValue: { onMemberJoined: jest.fn() } },
      ],
    }).compile();

    service = module.get<MemberService>(MemberService);
  });

  const written = () => prisma.membershipTier.update.mock.calls[0][0].data;

  it('stores the label the admin wrote', async () => {
    await service.updateTier('org-1', 'tier-1', { highlightLabel: '400 Needed to Sustain' });

    expect(written().highlightLabel).toBe('400 Needed to Sustain');
  });

  it('clears it from every other tier in the co-op', async () => {
    // The card grows, gains a border and carries a pill — emphasis only reads
    // as emphasis while one tier has it, and "highlight the Sustainer" means
    // instead of, not as well as.
    await service.updateTier('org-1', 'tier-1', { highlightLabel: 'Best value' });

    expect(prisma.membershipTier.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', id: { not: 'tier-1' }, highlightLabel: { not: null } },
      data: { highlightLabel: null },
    });
  });

  it('sets and clears in one transaction', async () => {
    // A half-applied change leaves two tiers badged, which is the state the
    // rule exists to prevent.
    await service.updateTier('org-1', 'tier-1', { highlightLabel: 'Best value' });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('treats a blank label as no badge', async () => {
    // An admin who clears the text means "stop showing it". Storing "" would
    // render an empty pill on the join page.
    await service.updateTier('org-1', 'tier-1', { highlightLabel: '   ' });

    expect(written().highlightLabel).toBeNull();
    expect(prisma.membershipTier.updateMany).not.toHaveBeenCalled();
  });

  it('leaves the badge alone when the field is not sent', async () => {
    // A PATCH that only changes the price must not silently remove a badge.
    await service.updateTier('org-1', 'tier-1', { description: 'Standard membership' });

    expect(written()).not.toHaveProperty('highlightLabel');
    expect(prisma.membershipTier.updateMany).not.toHaveBeenCalled();
  });

  it('never touches another co-op’s tiers', async () => {
    // SEC-04: the clear is scoped to the org that owns the tier being edited.
    await service.updateTier('org-1', 'tier-1', { highlightLabel: 'Best value' });

    expect(prisma.membershipTier.updateMany.mock.calls[0][0].where.orgId).toBe('org-1');
  });

  it('is published to the join page and the embed', () => {
    // Both public paths read the same constant, so a badge an admin sets is
    // either on all of them or on none.
    expect(PUBLIC_TIER_SELECT).toHaveProperty('highlightLabel', true);
  });
});
