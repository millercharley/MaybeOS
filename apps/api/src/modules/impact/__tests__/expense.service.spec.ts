import { Test, TestingModule } from '@nestjs/testing';
import { ExpenseService } from '../expense.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * The expense side of the financial section (IMP-16), amending D-021.
 *
 * D-021 made bookkeeping a non-goal and that still holds — this is the
 * smallest record that gives cost-per-outcome and mission-alignment-of-spend a
 * denominator. What these pin down is mostly the arithmetic of the alignment
 * figure, which is the one number here that can mislead: computed over the
 * wrong denominator it would always flatter the co-op.
 */
describe('ExpenseService', () => {
  let service: ExpenseService;
  let prisma: any;

  const grouped = (rows: { key: string | null; total: number; count: number }[], field: string) =>
    rows.map((r) => ({
      [field]: r.key,
      _sum: { amountCents: r.total },
      _count: { _all: r.count },
    }));

  beforeEach(async () => {
    prisma = {
      expense: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'e-1', orgId: 'org-1' }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'e-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ExpenseService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ExpenseService>(ExpenseService);
  });

  const withSpend = (byCategory: any[], byGoal: any[], total: number, count: number) => {
    prisma.expense.groupBy
      .mockResolvedValueOnce(byCategory)
      .mockResolvedValueOnce(byGoal);
    prisma.expense.aggregate.mockResolvedValue({
      _sum: { amountCents: total },
      _count: { _all: count },
    });
  };

  describe('mission alignment of spend', () => {
    it('counts unattributed spend in the denominator', () => {
      // The figure only means anything because spend with no goal is recorded.
      // Computed over attributed rows alone it would always be 1, which is the
      // easiest way to make this number worthless.
      withSpend(
        grouped([{ key: 'Programs', total: 7500, count: 2 }], 'category'),
        grouped(
          [
            { key: 'belonging', total: 5000, count: 1 },
            { key: null, total: 2500, count: 1 },
          ],
          'goalKey',
        ),
        7500,
        2,
      );

      return service.summary('org-1').then((s) => {
        expect(s.attributedShare).toBeCloseTo(5000 / 7500);
        expect(s.totalCents).toBe(7500);
      });
    });

    it('is null when nothing has been recorded, not zero', async () => {
      // "None of our spend serves our goals" and "we have recorded no spend"
      // are different claims, and a report must not make the second read as
      // the first.
      withSpend([], [], 0, 0);

      const s = await service.summary('org-1');

      expect(s.attributedShare).toBeNull();
      expect(s.expenseCount).toBe(0);
    });

    it('is 1 when every expense names a goal', async () => {
      withSpend(
        grouped([{ key: 'Programs', total: 4000, count: 1 }], 'category'),
        grouped([{ key: 'belonging', total: 4000, count: 1 }], 'goalKey'),
        4000,
        1,
      );

      expect((await service.summary('org-1')).attributedShare).toBe(1);
    });

    it('is 0 when none does', async () => {
      withSpend(
        grouped([{ key: 'Admin', total: 4000, count: 1 }], 'category'),
        grouped([{ key: null, total: 4000, count: 1 }], 'goalKey'),
        4000,
        1,
      );

      expect((await service.summary('org-1')).attributedShare).toBe(0);
    });

    it('reports the row count the figures rest on (G5)', async () => {
      withSpend(
        grouped([{ key: 'Programs', total: 100, count: 3 }], 'category'),
        grouped([{ key: null, total: 100, count: 3 }], 'goalKey'),
        100,
        3,
      );

      expect((await service.summary('org-1')).expenseCount).toBe(3);
    });
  });

  describe('scoping', () => {
    it('summarises only this org', async () => {
      withSpend([], [], 0, 0);
      await service.summary('org-1');

      expect(prisma.expense.aggregate.mock.calls[0][0].where.orgId).toBe('org-1');
    });

    it('resolves an expense through its org, never by bare id', async () => {
      // Same rule SEC-04's guard enforces elsewhere. This is money.
      await service.update('org-1', 'e-1', { amountCents: 500 });

      expect(prisma.expense.findFirst).toHaveBeenCalledWith({
        where: { id: 'e-1', orgId: 'org-1' },
      });
    });

    it('refuses to touch another co-op’s expense', async () => {
      prisma.expense.findFirst.mockResolvedValue(null);

      await expect(service.update('org-1', 'other', { amountCents: 1 })).rejects.toThrow();
      await expect(service.remove('org-1', 'other')).rejects.toThrow();
      expect(prisma.expense.delete).not.toHaveBeenCalled();
    });
  });

  describe('recording', () => {
    it('keeps an empty goal as null rather than an empty string', async () => {
      // An empty string would group as its own goal and quietly split the
      // unattributed bucket in two.
      const created = await service.create('org-1', 'user-1', {
        amountCents: 2500,
        incurredOn: '2026-08-01',
        category: '  Programs  ',
        goalKey: '   ',
      });

      expect(created.goalKey).toBeNull();
      expect(created.category).toBe('Programs');
    });

    it('records who entered it', async () => {
      const created = await service.create('org-1', 'user-1', {
        amountCents: 100,
        incurredOn: '2026-08-01',
        category: 'Space',
      });

      expect(created.createdBy).toBe('user-1');
    });
  });
});
