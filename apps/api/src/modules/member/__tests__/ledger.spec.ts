import { attribute, computeLedger, grantProblem, planImport, GrantLine, LedgerMember } from '../ledger';
import { LedgerService } from '../ledger.service';

/**
 * The member ledger (MEM-17).
 *
 * These figures are what every member of a co-op is told they own. The cases
 * worth pinning are the ones where a plausible page would be wrong: a share
 * that vanishes, a name that should not be there, an address that should
 * never be, and an import that quietly disagrees with the treasurer's sheet.
 */

const member = (over: Partial<LedgerMember> = {}): LedgerMember => ({
  userId: 'u-ada',
  email: 'ada@example.com',
  name: 'Ada',
  avatarUrl: null,
  avatarPath: null,
  role: 'MEMBER',
  isPublic: true,
  memberSince: new Date('2024-01-01T00:00:00Z'),
  headline: null,
  bio: null,
  location: null,
  tags: [],
  links: [],
  ...over,
});

const grant = (holderEmail: string, shares: number, kind: GrantLine['kind'] = 'ANNUAL'): GrantLine => ({
  holderEmail,
  kind,
  shares,
});

const MEMBER = { userId: 'u-viewer', privileged: false };
const ORGANISER = { userId: 'u-viewer', privileged: true };

describe('computeLedger', () => {
  it('sums each holder and lists the largest first', () => {
    const ledger = computeLedger(
      [grant('ada@example.com', 200), grant('bo@example.com', 5000, 'FOUNDER'), grant('ada@example.com', 100)],
      [member(), member({ userId: 'u-bo', email: 'bo@example.com', name: 'Bo' })],
      MEMBER,
    );

    expect(ledger.holders.map((h) => [h.rank, h.user.name, h.shares])).toEqual([
      [1, 'Bo', 5000],
      [2, 'Ada', 300],
    ]);
    expect(ledger.totalShares).toBe(5300);
  });

  it('lists a member with no shares at zero, because every member is on it', () => {
    const ledger = computeLedger([], [member()], MEMBER);

    expect(ledger.holders).toHaveLength(1);
    expect(ledger.holders[0].shares).toBe(0);
  });

  it('matches a grant to a member regardless of case', () => {
    const ledger = computeLedger([grant(' ADA@Example.com ', 100)], [member()], MEMBER);
    expect(ledger.holders[0].shares).toBe(100);
  });

  it('keeps a hidden member off the page but their shares in the total', () => {
    // `isPublic` was a promise the directory made. Its replacement keeps it —
    // and still adds up, because the shares are counted in an unnamed row.
    const ledger = computeLedger(
      [grant('ada@example.com', 100), grant('cy@example.com', 400)],
      [member(), member({ userId: 'u-cy', email: 'cy@example.com', name: 'Cy', isPublic: false })],
      MEMBER,
    );

    expect(ledger.holders.map((h) => h.user.name)).toEqual(['Ada']);
    expect(ledger.privateMembers).toEqual({ count: 1, shares: 400 });
    expect(ledger.reconciled).toBe(true);
  });

  it('shows a hidden member to organisers, marked as hidden', () => {
    const ledger = computeLedger(
      [],
      [member({ isPublic: false })],
      ORGANISER,
    );

    expect(ledger.holders[0].isPrivate).toBe(true);
    expect(ledger.privateMembers.count).toBe(0);
  });

  it('always shows you to yourself, hidden or not', () => {
    const ledger = computeLedger([], [member({ userId: 'u-viewer', isPublic: false })], MEMBER);

    expect(ledger.holders[0].isYou).toBe(true);
  });

  it('counts holders without a membership here, without naming them', () => {
    // The cap table predates most MaybeOS accounts. Those shares are real,
    // so they are counted; the people have not joined, so they are not named.
    const ledger = computeLedger(
      [grant('ada@example.com', 100), grant('gone@example.com', 700), grant('gone@example.com', 50)],
      [member()],
      MEMBER,
    );

    expect(ledger.unlinked).toEqual({ count: 1, shares: 750 });
    expect(ledger.reconciled).toBe(true);
  });

  it('never puts an email address anywhere in the result', () => {
    const ledger = computeLedger(
      [grant('ada@example.com', 100), grant('gone@example.com', 700)],
      [member(), member({ userId: 'u-cy', email: 'cy@example.com', isPublic: false })],
      ORGANISER,
    );
    const json = JSON.stringify(ledger);

    expect(json).not.toContain('ada@example.com');
    expect(json).not.toContain('cy@example.com');
    expect(json).not.toContain('gone@example.com');
    expect(json).not.toMatch(/"email"/);
  });

  it('breaks a holding down by kind', () => {
    const ledger = computeLedger(
      [grant('ada@example.com', 400), grant('ada@example.com', 800, 'FOUNDER')],
      [member()],
      MEMBER,
    );

    expect(ledger.holders[0].breakdown).toEqual({ ANNUAL: 400, FOUNDER: 800 });
  });

  it('carries the avatar path, so the global interceptor can sign it', () => {
    const ledger = computeLedger([], [member({ avatarPath: 'u-ada/face.jpg' })], MEMBER);
    expect(ledger.holders[0].user.avatarPath).toBe('u-ada/face.jpg');
  });
});

describe('planImport', () => {
  it('turns each non-zero column into a line', () => {
    const plan = planImport(
      [{ name: 'Ada', email: 'ada@example.com', annual: 400, founder: 800, totalShares: 1200 }],
      null,
    );

    expect(plan.lines.map((l) => [l.kind, l.shares])).toEqual([
      ['ANNUAL', 400],
      ['FOUNDER', 800],
    ]);
  });

  it('skips a row with no email and says how many shares it held', () => {
    // MaybeItsFate's LLC row: ten million founder shares, no email, and left
    // out of the sheet's own total because it describes the founders' shares.
    const plan = planImport(
      [{ name: 'MaybeItsFate LLC', email: '', founder: 10_000_000, totalShares: 10_000_000 }],
      null,
    );

    expect(plan.lines).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'MaybeItsFate LLC', shares: 10_000_000, reason: 'no-email' }]);
  });

  it('makes the balance match Total Shares when the parts disagree', () => {
    // One real row: 100 in Annual Grant, 0 in Total Shares. The sheet's total
    // is built from Total Shares, so that is what the member holds.
    const plan = planImport([{ name: 'Onyx', email: 'o@example.com', annual: 100, totalShares: 0 }], null);

    expect(plan.lines.map((l) => [l.kind, l.shares])).toEqual([
      ['ANNUAL', 100],
      ['ADJUSTMENT', -100],
    ]);
    expect(plan.importedShares).toBe(0);
    expect(plan.adjusted).toEqual([{ name: 'Onyx', parts: 100, total: 0 }]);
  });

  it('sums a person who appears on two rows, as the sheet itself does', () => {
    const plan = planImport(
      [
        { name: 'Dee', email: 'dee@example.com', annual: 200, totalShares: 200 },
        { name: 'Dee', email: 'DEE@example.com', annual: 100, totalShares: 100 },
      ],
      300,
    );

    expect(plan.holders).toBe(1);
    expect(plan.repeatedEmails).toBe(1);
    expect(plan.importedShares).toBe(300);
    expect(plan.matchesSheet).toBe(true);
  });

  it('says when the import disagrees with the sheet total', () => {
    const plan = planImport([{ email: 'a@example.com', annual: 100, totalShares: 100 }], 250);
    expect(plan.matchesSheet).toBe(false);
  });

  it('treats an address without an @ as no address at all', () => {
    const plan = planImport([{ name: 'Typo', email: 'not-an-email', totalShares: 50, annual: 50 }], null);
    expect(plan.skipped[0].reason).toBe('no-email');
  });
});

describe('attribute — whose each line is (MEM-19)', () => {
  const members = [
    { userId: 'u-ada', email: 'ada@example.com' },
    { userId: 'u-bo', email: 'bo@example.com' },
  ];

  it('gives a line naming a member to that member', () => {
    const { held } = attribute([{ holderEmail: 'old@example.com', userId: 'u-ada', kind: 'ANNUAL', shares: 100 }], members);
    expect(held.get('u-ada')?.shares).toBe(100);
  });

  it('keeps a member’s lines theirs after they change their email', () => {
    // Imported while their address was old@; they are ada@ now.
    const { held, unlinked } = attribute(
      [{ holderEmail: 'old@example.com', userId: 'u-ada', kind: 'ANNUAL', shares: 100 }],
      members,
    );
    expect(held.get('u-ada')?.shares).toBe(100);
    expect(unlinked.size).toBe(0);
  });

  it('matches a line with no member by email', () => {
    const { held } = attribute([{ holderEmail: 'BO@example.com', kind: 'ANNUAL', shares: 50 }], members);
    expect(held.get('u-bo')?.shares).toBe(50);
  });

  it('never hands a departed member’s shares to whoever has their old address now', () => {
    // u-gone left; their line names them. Bo happens to hold the address the
    // line was imported under. Shares do not move because an address did.
    const { held, unlinked } = attribute(
      [{ holderEmail: 'bo@example.com', userId: 'u-gone', kind: 'FOUNDER', shares: 800 }],
      members,
    );
    expect(held.get('u-bo')).toBeUndefined();
    expect(unlinked.get('user:u-gone')?.shares).toBe(800);
  });
});

describe('grantProblem', () => {
  it('accepts an ordinary grant, to one or many', () => {
    expect(grantProblem('ANNUAL', 100, 1)).toBeNull();
    expect(grantProblem('ANNUAL', 100, 40)).toBeNull();
  });

  it('refuses zero and fractions', () => {
    expect(grantProblem('ANNUAL', 0, 1)).toMatch(/whole number/);
    expect(grantProblem('ANNUAL', 1.5, 1)).toMatch(/whole number/);
  });

  it('only lets an adjustment take shares away', () => {
    expect(grantProblem('ANNUAL', -10, 1)).toMatch(/Only an adjustment/);
    expect(grantProblem('ADJUSTMENT', -10, 1)).toBeNull();
  });

  it('never takes shares from a whole selection at once', () => {
    // How a slip becomes a mass correction.
    expect(grantProblem('ADJUSTMENT', -10, 5)).toMatch(/one member at a time/);
    expect(grantProblem('ADJUSTMENT', 10, 5)).toMatch(/one member at a time/);
  });
});

describe('LedgerService', () => {
  let prisma: any;
  let service: LedgerService;
  const rows = [{ name: 'Ada', email: 'ada@example.com', annual: 100, totalShares: 100 }];
  const ADA = '11111111-1111-4111-8111-111111111111';
  const BO = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ sharesEnabled: true }) },
      shareGrant: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _sum: { shares: 0 }, _max: { importedAt: null } }),
      },
      userOrg: {
        findMany: jest.fn().mockResolvedValue([{ userId: ADA, user: { email: 'ada@example.com', name: 'Ada' } }]),
        findUnique: jest.fn().mockResolvedValue({ user: { email: 'ada@example.com', name: 'Ada' } }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    };
    service = new LedgerService(prisma);
  });

  describe('importing the cap table', () => {
    it('writes nothing on a dry run, and says who it would link', async () => {
      const result = await service.importCapTable('org-1', { rows, sheetTotal: 100 } as never);

      expect(result.dryRun).toBe(true);
      expect(result.linkedToMembers).toBe(1);
      expect(prisma.shareGrant.createMany).not.toHaveBeenCalled();
      expect(prisma.shareGrant.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses to publish a ledger that disagrees with the sheet', async () => {
      await expect(
        service.importCapTable('org-1', { rows, sheetTotal: 999, dryRun: false } as never),
      ).rejects.toThrow(/sheet's own total/);
      expect(prisma.shareGrant.createMany).not.toHaveBeenCalled();
    });

    it('publishes it anyway when told the difference is understood', async () => {
      await service.importCapTable('org-1', { rows, sheetTotal: 999, dryRun: false, acceptMismatch: true } as never);
      expect(prisma.shareGrant.createMany).toHaveBeenCalled();
    });

    it('replaces only the previous import — shares granted in MaybeOS survive it', async () => {
      await service.importCapTable('org-1', { rows, sheetTotal: 100, dryRun: false } as never);

      expect(prisma.shareGrant.deleteMany).toHaveBeenCalledWith({ where: { orgId: 'org-1', source: 'IMPORT' } });
      expect(prisma.shareGrant.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.shareGrant.createMany.mock.invocationCallOrder[0],
      );
    });

    it('stamps the member on each line it can match', async () => {
      await service.importCapTable('org-1', { rows, sheetTotal: 100, dryRun: false } as never);
      expect(prisma.shareGrant.createMany.mock.calls[0][0].data[0]).toMatchObject({ userId: ADA, source: 'IMPORT' });
    });

    it('says how many shares were granted in MaybeOS, so a double count can be spotted', async () => {
      prisma.shareGrant.aggregate.mockResolvedValue({ _sum: { shares: 500 } });
      const result = await service.importCapTable('org-1', { rows, sheetTotal: 100 } as never);
      expect(result.manualShares).toBe(500);
    });

    it('returns names, never addresses', async () => {
      const result = await service.importCapTable(
        'org-1',
        { rows: [...rows, { name: 'No Email LLC', totalShares: 5 }], sheetTotal: 100 } as never,
      );
      expect(JSON.stringify(result)).not.toContain('ada@example.com');
    });

    it('refuses while share tracking is off', async () => {
      prisma.organization.findUnique.mockResolvedValue({ sharesEnabled: false });
      await expect(service.importCapTable('org-1', { rows } as never)).rejects.toThrow(/turn it on in Settings/);
    });
  });

  describe('granting shares', () => {
    it('grants to every member chosen, each line naming its member and its granter', async () => {
      prisma.userOrg.findMany.mockResolvedValue([
        { userId: ADA, user: { email: 'Ada@Example.com', name: 'Ada' } },
        { userId: BO, user: { email: 'bo@example.com', name: 'Bo' } },
      ]);

      const result = await service.grant('org-1', 'admin-1', {
        userIds: [ADA, BO, ADA],
        kind: 'ANNUAL',
        shares: 100,
        note: ' 2026 patronage ',
      });

      expect(result).toEqual({ members: 2, sharesEach: 100, totalGranted: 200 });
      expect(prisma.shareGrant.createMany.mock.calls[0][0].data[0]).toEqual({
        orgId: 'org-1',
        userId: ADA,
        holderEmail: 'ada@example.com',
        holderName: 'Ada',
        kind: 'ANNUAL',
        shares: 100,
        source: 'MANUAL',
        note: '2026 patronage',
        grantedById: 'admin-1',
      });
    });

    it('grants nothing at all if anyone chosen is not a member', async () => {
      await expect(
        service.grant('org-1', 'admin-1', { userIds: [ADA, BO], kind: 'ANNUAL', shares: 100 }),
      ).rejects.toThrow(/nothing was granted/);
      expect(prisma.shareGrant.createMany).not.toHaveBeenCalled();
    });

    it('refuses a grant grantProblem refuses', async () => {
      await expect(
        service.grant('org-1', 'admin-1', { userIds: [ADA, BO], kind: 'ANNUAL', shares: -5 }),
      ).rejects.toThrow(/Only an adjustment/);
    });

    it('refuses while share tracking is off', async () => {
      prisma.organization.findUnique.mockResolvedValue({ sharesEnabled: false });
      await expect(
        service.grant('org-1', 'admin-1', { userIds: [ADA], kind: 'ANNUAL', shares: 1 }),
      ).rejects.toThrow(/turn it on in Settings/);
    });
  });

  describe('setting a total', () => {
    it('records the difference as an adjustment line', async () => {
      prisma.shareGrant.aggregate.mockResolvedValue({ _sum: { shares: 300 } });

      const result = await service.setTotal('org-1', 'admin-1', ADA, { total: 500, expectedCurrent: 300 });

      expect(result).toEqual({ changed: true, total: 500, adjustment: 200 });
      expect(prisma.shareGrant.create.mock.calls[0][0].data).toMatchObject({
        kind: 'ADJUSTMENT',
        shares: 200,
        source: 'MANUAL',
        userId: ADA,
      });
    });

    it('writes nothing when the balance is already that figure', async () => {
      prisma.shareGrant.aggregate.mockResolvedValue({ _sum: { shares: 300 } });
      const result = await service.setTotal('org-1', 'admin-1', ADA, { total: 300, expectedCurrent: 300 });

      expect(result.changed).toBe(false);
      expect(prisma.shareGrant.create).not.toHaveBeenCalled();
    });

    it('refuses when the balance moved while the admin was editing', async () => {
      prisma.shareGrant.aggregate.mockResolvedValue({ _sum: { shares: 300 } });

      await expect(
        service.setTotal('org-1', 'admin-1', ADA, { total: 500, expectedCurrent: 100 }),
      ).rejects.toThrow(/changed to 300 while you were editing/);
      expect(prisma.shareGrant.create).not.toHaveBeenCalled();
    });
  });

  describe('the Members page read', () => {
    it('does not read a single grant while share tracking is off', async () => {
      prisma.organization.findUnique.mockResolvedValue({ sharesEnabled: false });
      const result = await service.getLedger('org-1', { userId: 'viewer', privileged: false });

      expect(result.sharesEnabled).toBe(false);
      expect(prisma.shareGrant.findMany).not.toHaveBeenCalled();
      expect(prisma.shareGrant.aggregate).not.toHaveBeenCalled();
    });
  });
});
