import { Test, TestingModule } from '@nestjs/testing';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';
import { ConfigService } from '@nestjs/config';

/**
 * The member spotlight (MEM-12).
 *
 * A card that says "meet this person" is the one place in the product where
 * getting the audience wrong is a real harm rather than a bug: featuring
 * somebody who hid themselves puts them in front of every member of the co-op,
 * which is precisely what they opted out of. Every test here is one of the
 * ways the obvious implementation does that.
 */
describe('MemberService — spotlight', () => {
  let service: MemberService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';
  const VIEWER = 'viewer-user';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        {
          provide: PrismaService,
          useValue: {
            userOrg: {
              count: jest.fn().mockResolvedValue(0),
              findFirst: jest.fn().mockResolvedValue(null),
            },
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

  const whereOf = () => (prisma.userOrg.count.mock.calls[0][0] as { where: Record<string, unknown> }).where;

  it('never features the person looking at it', async () => {
    // "Send them a message" would open a conversation with yourself.
    prisma.userOrg.count.mockResolvedValue(3 as never);
    await service.spotlight(ORG, VIEWER);

    expect(whereOf()).toMatchObject({ userId: { not: VIEWER } });
  });

  it('never features somebody who hid themselves — whoever is looking', async () => {
    // The directory lets organisers see hidden members, because running a
    // co-op means knowing who is in it. This is not that. There is no role
    // parameter here at all, and that is the point.
    prisma.userOrg.count.mockResolvedValue(3 as never);
    await service.spotlight(ORG, VIEWER);

    expect(whereOf()).toMatchObject({ isPublic: true });
  });

  it('draws from members, not guests', async () => {
    prisma.userOrg.count.mockResolvedValue(3 as never);
    await service.spotlight(ORG, VIEWER);

    expect(whereOf()).toMatchObject({ role: { in: ['ADMIN', 'STAFF', 'MEMBER'] } });
  });

  it('stays inside this co-op', async () => {
    prisma.userOrg.count.mockResolvedValue(3 as never);
    await service.spotlight(ORG, VIEWER);

    expect(whereOf()).toMatchObject({ orgId: ORG });
  });

  it('shows nobody when there is nobody else', async () => {
    // A co-op of one, or one where everybody else has hidden. No card beats a
    // card that says nothing.
    prisma.userOrg.count.mockResolvedValue(0 as never);

    await expect(service.spotlight(ORG, VIEWER)).resolves.toBeNull();
    expect(prisma.userOrg.findFirst).not.toHaveBeenCalled();
  });

  it('picks a different one across visits', async () => {
    // The offset is what makes it random; a fixed skip would feature the same
    // person forever and the feature would be decoration.
    prisma.userOrg.count.mockResolvedValue(50 as never);

    const skips = new Set<number>();
    for (let i = 0; i < 25; i += 1) {
      await service.spotlight(ORG, VIEWER);
      const call = prisma.userOrg.findFirst.mock.calls.at(-1)![0] as { skip: number };
      skips.add(call.skip);
    }

    expect(skips.size).toBeGreaterThan(1);
    expect(Math.max(...skips)).toBeLessThan(50);
    expect(Math.min(...skips)).toBeGreaterThanOrEqual(0);
  });

  it('orders the pool, so the offset draws from a stable deck', async () => {
    prisma.userOrg.count.mockResolvedValue(5 as never);
    await service.spotlight(ORG, VIEWER);

    const call = prisma.userOrg.findFirst.mock.calls[0][0] as { orderBy: unknown };
    expect(call.orderBy).toBeDefined();
  });

  it('never selects an email address', async () => {
    // Members do not get each other's contact details, and a card designed to
    // be seen by everybody is the last place to start.
    prisma.userOrg.count.mockResolvedValue(3 as never);
    await service.spotlight(ORG, VIEWER);

    const call = prisma.userOrg.findFirst.mock.calls[0][0] as {
      select: { user: { select: Record<string, unknown> } };
    };
    expect(call.select.user.select).not.toHaveProperty('email');
    expect(call.select).not.toHaveProperty('emailOptIn');
  });
});
