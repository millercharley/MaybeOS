import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';
import { AuditService } from '../../platform/audit.service';

/**
 * The filters as the query actually receives them (MEM-26).
 *
 * `member-filters.spec.ts` covers the rules; this covers the wiring, where the
 * mistakes are of a different kind — a condition built correctly and then
 * overwritten on its way into Prisma.
 */
describe('MemberService — narrowing the members list', () => {
  let service: MemberService;
  let prisma: any;

  const ORGANISER = { userId: 'admin-1', privileged: true };
  const MEMBER = { userId: 'user-1', privileged: false };

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };

    const module = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: BuddyService, useValue: {} },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  /** The `where` and `orderBy` Prisma was actually handed. */
  async function queried(viewer: any, search?: string, filters: any = {}) {
    await service.listMembers('org-1', viewer, 1, 20, search, filters);
    const call = prisma.userOrg.findMany.mock.calls[0][0];
    return { where: call.where, orderBy: call.orderBy };
  }

  it('keeps the search and the sign-in filter side by side', async () => {
    /*
      The bug this exists for.

      Both conditions live on `user`, and the search used to *assign* that key
      rather than merge into it. Searching inside "never signed in" would have
      quietly searched everybody, and the screen would have shown a filter it
      was not applying.
    */
    const { where } = await queried(ORGANISER, 'ada', { activity: 'never' });

    expect(where.user.lastLoginAt).toBeNull();
    expect(where.user.OR).toEqual([
      { name: { contains: 'ada', mode: 'insensitive' } },
      { email: { contains: 'ada', mode: 'insensitive' } },
    ]);
  });

  it('always scopes to this co-op, whatever was asked for', async () => {
    const { where } = await queried(ORGANISER, undefined, {
      role: 'STAFF',
      status: 'ACTIVE',
      flag: 'bounced',
    });

    expect(where.orgId).toBe('org-1');
    expect(where.role).toBe('STAFF');
    expect(where.subscriptionStatus).toBe('ACTIVE');
    expect(where.signInBouncedAt).toEqual({ not: null });
  });

  it('still hides the members who hid themselves, from an ordinary member', async () => {
    // FRM-01, and a filter must not be a way around it.
    const { where } = await queried(MEMBER, undefined, { flag: 'hidden' });

    expect(where.isPublic).toBe(true);
  });

  it('lets an organiser find the members who hid themselves', async () => {
    const { where } = await queried(ORGANISER, undefined, { flag: 'hidden' });

    expect(where.isPublic).toBe(false);
  });

  it('ignores a dues filter from an ordinary member without refusing them', async () => {
    // Dropped, not 403: a refusal is itself an answer about what exists.
    const { where } = await queried(MEMBER, undefined, { status: 'PAST_DUE' });

    expect(where.subscriptionStatus).toBeUndefined();
  });

  it('orders by what was asked for', async () => {
    const { orderBy } = await queried(ORGANISER, undefined, { sort: 'name-asc' });

    expect(orderBy).toEqual([{ user: { name: 'asc' } }]);
  });

  it('reports the sort and whether anything is narrowing the list', async () => {
    // What the server applied, which is not always what was asked.
    const result = await service.listMembers('org-1', MEMBER as any, 1, 20, undefined, {
      sort: 'status',
      status: 'ACTIVE',
    });

    expect(result.meta.sort).toBe('joined-desc');
    expect(result.meta.narrowed).toBe(false);
  });
});
