import { computeLedger, planImport, GrantLine, LedgerMember } from '../ledger';
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

describe('LedgerService.importCapTable', () => {
  let prisma: any;
  let service: LedgerService;
  const rows = [{ name: 'Ada', email: 'ada@example.com', annual: 100, totalShares: 100 }];

  beforeEach(() => {
    prisma = {
      shareGrant: { deleteMany: jest.fn(), createMany: jest.fn() },
      userOrg: { findMany: jest.fn().mockResolvedValue([{ user: { email: 'ada@example.com' } }]) },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    service = new LedgerService(prisma);
  });

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

  it('replaces the previous import whole, in one transaction', async () => {
    await service.importCapTable('org-1', { rows, sheetTotal: 100, dryRun: false } as never);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.shareGrant.deleteMany).toHaveBeenCalledWith({ where: { orgId: 'org-1' } });
    expect(prisma.shareGrant.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.shareGrant.createMany.mock.invocationCallOrder[0],
    );
  });

  it('returns names, never addresses', async () => {
    const result = await service.importCapTable(
      'org-1',
      { rows: [...rows, { name: 'No Email LLC', totalShares: 5 }], sheetTotal: 100 } as never,
    );
    expect(JSON.stringify(result)).not.toContain('ada@example.com');
  });
});
