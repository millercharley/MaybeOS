import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrgService } from '../org.service';
import { PrismaService } from '../../../config/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ForumService } from '../forum.service';
import { AuditService } from '../../platform/audit.service';

/**
 * The membership embed (PUB-01) — a co-op's tiers on their own website.
 *
 * The second route in MaybeOS that answers to any origin, so what it selects
 * is the whole of what it publishes. It shares `PUBLIC_TIER_SELECT` with the
 * join page for the reason MEM-14 exists: two selects drift, and the one that
 * drifts is the one nobody is looking at.
 */
describe('OrgService — the membership embed', () => {
  let service: OrgService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Sunrise',
          slug: 'sunrise',
          allowPublicJoin: true,
          tiers: [{ id: 't1', name: 'Sustainer' }],
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: ForumService, useValue: {} },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get<OrgService>(OrgService);
  });

  const selection = () => prisma.organization.findUnique.mock.calls[0][0].select;

  it('publishes the co-op’s name, slug and whether its doors are open', async () => {
    const result = await service.embedMembership('sunrise');

    expect(result.name).toBe('Sunrise');
    expect(result.allowPublicJoin).toBe(true);
  });

  it('publishes nothing else about the co-op', async () => {
    // The whole row is what leaks: Stripe account and subscription ids, the
    // billing waiver and its reason, suspension notes. A select, not a
    // redaction list — a column added tomorrow is absent from one and present
    // in the other.
    await service.embedMembership('sunrise');

    expect(Object.keys(selection()).sort()).toEqual([
      'allowPublicJoin',
      'name',
      'slug',
      'tiers',
    ]);
  });

  it('asks for the same tier columns the public join page uses', async () => {
    await service.embedMembership('sunrise');

    const tierFields = Object.keys(selection().tiers.select).sort();
    expect(tierFields).toEqual([
      'benefits',
      'description',
      'id',
      'isPayWhatYouCan',
      'maxMembers',
      'minPrice',
      'name',
      'priceMonthly',
      'priceYearly',
      'serviceMinutes',
      'servicePeriod',
    ]);
    expect(tierFields).not.toContain('stripePriceIdMonthly');
  });

  it('shows only active tiers, in the order the admin set', async () => {
    await service.embedMembership('sunrise');

    expect(selection().tiers.where).toEqual({ isActive: true });
    expect(selection().tiers.orderBy).toEqual({ sortOrder: 'asc' });
  });

  it('404s for a slug that is not a co-op', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);

    await expect(service.embedMembership('nobody')).rejects.toThrow(NotFoundException);
  });
});
