import { Test } from '@nestjs/testing';
import { LedgerService } from '../ledger.service';
import { PrismaService } from '../../../config/prisma.service';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A member's own shares, on their own profile (MEM-24).
 *
 * Charley, 2026-10-02: the directory listing everyone's holding "feels like a
 * ranking" — it was one, ordered largest first and numbered. What somebody
 * owns of their co-op moved to their own profile, for their eyes.
 *
 * The guarantee is structural rather than careful: this route takes no userId
 * and has nowhere to put one, so it cannot be aimed at another member.
 */

describe('your own holding', () => {
  let service: LedgerService;
  let prisma: any;

  const lines = [
    { id: 'g1', kind: 'ANNUAL', shares: 400, source: 'IMPORT', note: null, importedAt: new Date('2025-01-01'), grantedById: null },
    { id: 'g2', kind: 'FOUNDER', shares: 5000, source: 'IMPORT', note: null, importedAt: new Date('2024-01-01'), grantedById: null },
  ];

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ sharesEnabled: true }) },
      userOrg: { findUnique: jest.fn().mockResolvedValue({ user: { email: 'ada@example.com' } }) },
      shareGrant: {
        findMany: jest.fn().mockResolvedValue(lines),
        aggregate: jest.fn().mockResolvedValue({ _max: { importedAt: null } }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module = await Test.createTestingModule({
      providers: [LedgerService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(LedgerService);
  });

  it('adds up every grant behind the balance', async () => {
    const mine = await service.getMine('org-1', 'u-ada');

    expect(mine.shares).toBe(5400);
    expect(mine.lines).toHaveLength(2);
  });

  it('carries the co-op’s total, because a share count alone means nothing', async () => {
    // 5,400 shares is a fact. What somebody actually wants to know is what
    // fraction of the co-op that is, and they cannot work it out alone.
    prisma.shareGrant.findMany.mockImplementation(({ where }: any) =>
      where?.OR ? lines : [...lines, { ...lines[0], id: 'g3', shares: 94_600 }],
    );

    const mine = await service.getMine('org-1', 'u-ada');

    expect(mine.totalShares).toBe(100_000);
    expect(mine.shares).toBe(5400);
  });

  it('says nothing at all when the co-op does not track shares', async () => {
    prisma.organization.findUnique.mockResolvedValue({ sharesEnabled: false });

    const mine = await service.getMine('org-1', 'u-ada');

    expect(mine).toEqual({ sharesEnabled: false, shares: 0, totalShares: 0, lines: [] });
    expect(prisma.shareGrant.findMany).not.toHaveBeenCalled();
  });

  it('never returns an email address', async () => {
    // The lines are matched on the holder's address, which is how a cap table
    // imported before anybody had an account finds its member.
    const mine = await service.getMine('org-1', 'u-ada');

    expect(JSON.stringify(mine)).not.toContain('ada@example.com');
  });
});

describe('the route cannot be aimed at anybody else', () => {
  const controller = readFileSync(join(__dirname, '..', 'ledger.controller.ts'), 'utf8');

  it('takes the member from the token, not the path', () => {
    expect(controller).toMatch(/@Get\('ledger\/mine'\)/);
    expect(controller).toMatch(/this\.ledger\.getMine\(orgId, user\.userId\)/);
  });

  it('has no userId parameter to supply', () => {
    const route = controller.slice(controller.indexOf("@Get('ledger/mine')"));
    const body = route.slice(0, route.indexOf('}\n'));

    expect(body).not.toMatch(/userId'/);
  });

  it('is open to members, not only organisers', () => {
    const route = controller.slice(controller.indexOf("@Get('ledger/mine')"));

    expect(route.slice(0, 400)).toMatch(/@Roles\('ADMIN', 'STAFF', 'MEMBER'\)/);
  });
});
