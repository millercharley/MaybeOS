import { Test, TestingModule } from '@nestjs/testing';
import { OrgService } from '../org.service';
import { PrismaService } from '../../../config/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ForumService } from '../forum.service';
import { AuditService } from '../../platform/audit.service';
import { PUBLIC_ORG_SELECT } from '../org-view';

/**
 * `/orgs/by-slug/:slug` is unauthenticated and always has been (SEC-11).
 *
 * It returned the whole row. Confirmed live on production before the fix: the
 * connected Stripe account id, the plan customer and subscription ids, the
 * portal config id, `billingWaived` with its free-text reason, `suspendedAt`
 * with its reason, the revenue share, the volunteer hour rate and the entire
 * `settings` blob — to anyone who could type a slug.
 *
 * This pins the shape rather than checking a handful of absences, for the
 * reason the tier version does: a redaction list forgets tomorrow's column,
 * and the test that only asserts today's absences passes while it leaks.
 */
describe('what the public org endpoint publishes', () => {
  let service: OrgService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-1', tiers: [] }) },
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

  it('publishes exactly these columns and no others', async () => {
    await service.findBySlug('sunrise');

    const select = prisma.organization.findUnique.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual([
      'allowPublicJoin',
      'brandColor',
      'description',
      'id',
      'logoUrl',
      'mission',
      'name',
      'plan',
      'slug',
      'stripeChargesEnabled',
      'ticketFeeCents',
      'tiers',
    ]);
  });

  it('never selects the co-op’s Stripe identity or its arrangement with MaybeOS', () => {
    // Named individually as well as pinned above, because these are the ones
    // that were actually going out and the list is the record of it.
    for (const field of [
      'stripeAccountApi',
      'stripePlanCustomerId',
      'stripePlanSubscriptionId',
      'stripePortalConfigId',
      'billingWaived',
      'billingWaivedReason',
      'suspendedAt',
      'suspendedReason',
      'hostRevenueShareBps',
      'settings',
    ]) {
      expect(PUBLIC_ORG_SELECT).not.toHaveProperty(field);
    }
  });

  it('does not fetch the co-op’s locations', async () => {
    // They came back with the old `include` and nothing read them.
    await service.findBySlug('sunrise');

    expect(prisma.organization.findUnique.mock.calls[0][0].select).not.toHaveProperty('locations');
    expect(prisma.organization.findUnique.mock.calls[0][0]).not.toHaveProperty('include');
  });
});
