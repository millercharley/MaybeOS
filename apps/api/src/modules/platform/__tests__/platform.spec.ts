import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PlatformService } from '../platform.service';
import { AuditService, PLATFORM_ACTIONS } from '../audit.service';
import { PlatformAdminGuard } from '../../../common/guards/platform-admin.guard';
import { PrismaService } from '../../../config/prisma.service';

const ctx = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

/**
 * The super-admin console (PLT-01).
 *
 * The tests are about the boundary, because the boundary *is* the feature:
 * `PLATFORM_ADMIN` used to be a bypass on every org-scoped guard in the
 * product, and what replaced it must answer about co-ops and never about
 * their members.
 */
describe('PlatformAdminGuard', () => {
  const guard = new PlatformAdminGuard();

  it('opens the console for a platform admin', () => {
    expect(guard.canActivate(ctx({ userId: '1', globalRole: 'PLATFORM_ADMIN' }))).toBe(true);
  });

  it('refuses everybody else, including a co-op’s own admin', () => {
    expect(() => guard.canActivate(ctx({ userId: '1', globalRole: 'USER', orgRoles: { o: 'ADMIN' } })))
      .toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});

describe('PlatformService', () => {
  let service: PlatformService;
  let prisma: any;
  let audit: any;

  const org = (over: Record<string, unknown> = {}) => ({
    id: 'org-1',
    name: 'Sunrise',
    slug: 'sunrise',
    customDomain: null,
    plan: 'FREE',
    planStatus: null,
    billingWaived: false,
    billingWaivedReason: null,
    suspendedAt: null,
    suspendedReason: null,
    createdAt: new Date(),
    stripeChargesEnabled: true,
    _count: { users: 12, events: 3, rooms: 1 },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      organization: {
        findMany: jest.fn().mockResolvedValue([org()]),
        findUnique: jest.fn().mockResolvedValue({ id: 'org-1', plan: 'FREE', billingWaived: false, suspendedAt: null }),
        update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'org-1', ...data })),
        count: jest.fn().mockResolvedValue(1),
        groupBy: jest.fn().mockResolvedValue([{ plan: 'FREE', _count: { _all: 1 } }]),
      },
      userOrg: {
        findMany: jest.fn().mockResolvedValue([
          { orgId: 'org-1', user: { name: 'Maya', email: 'maya@sunrise.coop' } },
        ]),
        count: jest.fn().mockResolvedValue(12),
      },
    };
    audit = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<PlatformService>(PlatformService);
  });

  describe('what the console may see', () => {
    it('answers about co-ops, not members', async () => {
      const [row] = await service.listOrgs();

      // Counts, never a roster. Charley's rule, and the whole design.
      expect(row.memberCount).toBe(12);
      expect(JSON.stringify(row)).not.toMatch(/demographics|bio|avatarPath/);
    });

    it('gives one organiser to contact, not the member list', async () => {
      const [row] = await service.listOrgs();

      // The deliberate exception: a platform with no way to reach the person
      // running a co-op cannot support it.
      expect(row.contact).toEqual({ name: 'Maya', email: 'maya@sunrise.coop' });
      expect(prisma.userOrg.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ role: 'ADMIN' }) }),
      );
    });

    it('surfaces a co-op that started Stripe and never finished', async () => {
      // `stripeAccountId` set with charges disabled: a co-op that believes it
      // is selling tickets and is not. Invisible everywhere else.
      prisma.organization.findMany.mockResolvedValue([org({ stripeChargesEnabled: false })]);

      expect((await service.listOrgs())[0].stripeHalfConnected).toBe(true);
    });

    it('surfaces a co-op with no organiser at all', async () => {
      prisma.userOrg.findMany.mockResolvedValue([]);

      const [row] = await service.listOrgs();

      expect(row.hasNoAdmin).toBe(true);
      expect(row.contact).toBeNull();
    });

    it('shows the fee its buyers actually pay', async () => {
      // The change a co-op feels is the per-transaction one, and it is not in
      // the plan's name.
      expect((await service.listOrgs())[0].transactionFeeCents).toBe(100);
    });
  });

  describe('suspending', () => {
    it('records it in the co-op’s own log, with the reason', async () => {
      await service.suspend('org-1', 'admin-1', '  Abuse reports  ');

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          actorId: 'admin-1',
          action: PLATFORM_ACTIONS.ORG_SUSPENDED,
          metadata: { reason: 'Abuse reports' },
        }),
      );
    });

    it('does not delete anything', async () => {
      await service.suspend('org-1', 'admin-1', 'Abuse reports');

      const { data } = prisma.organization.update.mock.calls[0][0];
      expect(Object.keys(data)).toEqual(['suspendedAt', 'suspendedReason']);
    });

    it('refuses to suspend twice, or restore what is not suspended', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', suspendedAt: new Date() });
      await expect(service.suspend('org-1', 'a', 'again')).rejects.toThrow(BadRequestException);

      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', suspendedAt: null });
      await expect(service.restore('org-1', 'a')).rejects.toThrow(BadRequestException);
    });
  });

  describe('plans and waivers', () => {
    it('keeps them as two switches', async () => {
      // Comping by moving a co-op to FREE would triple its members' ticket
      // fees — the opposite of a gift.
      await service.setPlan('org-1', 'a', { plan: 'UNLIMITED', billingWaived: true, reason: 'Founding co-op' });

      const { data } = prisma.organization.update.mock.calls[0][0];
      expect(data).toMatchObject({ plan: 'UNLIMITED', billingWaived: true });
    });

    it('logs the fee change a co-op will actually feel', async () => {
      await service.setPlan('org-1', 'a', { plan: 'UNLIMITED' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PLATFORM_ACTIONS.ORG_PLAN_CHANGED,
          metadata: expect.objectContaining({ transactionFeeFrom: 100, transactionFeeTo: 10 }),
        }),
      );
    });

    it('does not log a change that did not happen', async () => {
      await service.setPlan('org-1', 'a', { plan: 'FREE' });

      expect(audit.record).not.toHaveBeenCalled();
    });

    it('clears the reason when a waiver is lifted', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', plan: 'FREE', billingWaived: true });

      await service.setPlan('org-1', 'a', { billingWaived: false });

      expect(prisma.organization.update.mock.calls[0][0].data.billingWaivedReason).toBeNull();
    });
  });
});
