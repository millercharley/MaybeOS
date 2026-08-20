import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GoalsService } from '../goals.service';
import { PrismaService } from '../../../config/prisma.service';
import { draftIndicatorsFor } from '../goal-drafting';

/**
 * The measurement plan (IMP-21).
 *
 * The rule worth pinning is that editing un-approves. An approval that
 * survives its own contents changing is a signature on a blank page, and the
 * PRD has an admin approve a plan *before* anything is asked against it.
 */
describe('GoalsService', () => {
  let service: GoalsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ mission: 'A city where nobody is alone' }),
        update: jest.fn().mockResolvedValue({}),
      },
      goal: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'goal-1' }),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'goal-1', ...data, indicators: [] })),
        update: jest.fn().mockResolvedValue({ id: 'goal-1', title: 'x', indicators: [] }),
      },
      indicator: {
        upsert: jest.fn().mockResolvedValue({ id: 'ind-1' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'ind-1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      measurementPlan: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ update }: any) => ({
          status: update.status,
          approvedAt: update.approvedAt ?? null,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GoalsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<GoalsService>(GoalsService);
  });

  const unapprovals = () =>
    prisma.measurementPlan.upsert.mock.calls.filter((c: any[]) => c[0].update.status === 'DRAFT');

  describe('editing returns the plan to draft', () => {
    it('when a goal is added', async () => {
      await service.createGoal('org-1', { title: 'People make friends they keep' });
      expect(unapprovals()).toHaveLength(1);
    });

    it('when a goal is edited', async () => {
      await service.updateGoal('org-1', 'goal-1', { title: 'Changed' });
      expect(unapprovals()).toHaveLength(1);
    });

    it('when a goal is archived', async () => {
      await service.archiveGoal('org-1', 'goal-1');
      expect(unapprovals()).toHaveLength(1);
    });

    it('when an indicator is added or removed', async () => {
      await service.addIndicator('org-1', 'goal-1', { category: 'belonging', label: 'Belonging' });
      await service.removeIndicator('org-1', 'goal-1', 'ind-1');
      expect(unapprovals()).toHaveLength(2);
    });

    it('when the mission is rewritten', async () => {
      await service.setMission('org-1', 'Something else entirely');
      expect(unapprovals()).toHaveLength(1);
    });
  });

  describe('archiving, not deleting', () => {
    it('stamps archivedAt rather than removing the row', async () => {
      // A goal a co-op pursued for a year is part of what its report says,
      // and the figures collected against it would otherwise be untraceable.
      await service.archiveGoal('org-1', 'goal-1');

      expect(prisma.goal.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { archivedAt: expect.any(Date) } }),
      );
    });
  });

  describe('what approval requires', () => {
    it('refuses a plan with no goals', async () => {
      prisma.goal.findMany.mockResolvedValue([]);

      await expect(service.approve('org-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('refuses a plan where nothing is measured', async () => {
      // An approved plan that measures nothing is the worst of both: it reads
      // as a decision made, and produces no figure ever.
      prisma.goal.findMany.mockResolvedValue([{ id: 'goal-1', indicators: [] }]);

      await expect(service.approve('org-1', 'user-1')).rejects.toThrow(/anything measuring it/i);
    });

    it('accepts once one goal has an indicator', async () => {
      prisma.goal.findMany.mockResolvedValue([
        { id: 'goal-1', indicators: [{ id: 'ind-1' }] },
        { id: 'goal-2', indicators: [] },
      ]);

      const result = await service.approve('org-1', 'user-1');

      expect(result.status).toBe('APPROVED');
    });

    it('records who approved it', async () => {
      prisma.goal.findMany.mockResolvedValue([{ id: 'goal-1', indicators: [{ id: 'ind-1' }] }]);

      await service.approve('org-1', 'user-7');

      expect(prisma.measurementPlan.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ approvedById: 'user-7' }) }),
      );
    });
  });

  describe('limits', () => {
    it('holds the plan to five goals', async () => {
      // The discipline is the point: a co-op measuring nine things measures
      // none of them, and the fatigue budget only has room for a handful.
      prisma.goal.count.mockResolvedValue(GoalsService.MAX_GOALS);

      await expect(service.createGoal('org-1', { title: 'A sixth' })).rejects.toThrow(/at most 5/i);
    });

    it('refuses an indicator nothing actually measures', async () => {
      // A category no question asks about would sit on the plan forever with
      // no figure behind it, reading as a goal the co-op is failing at rather
      // than one it never measured.
      await expect(
        service.addIndicator('org-1', 'goal-1', { category: 'gardening_skill', label: 'Gardening' }),
      ).rejects.toThrow(/Nothing MaybeOS asks measures/);
    });
  });
});

/**
 * Proposing how to measure a goal.
 *
 * Deliberately *not* the AI drafter D-021 describes — MaybeOS has no LLM
 * client and no decision about what a co-op's mission may be sent to. These
 * are suggestions a human keeps or discards.
 */
describe('draftIndicatorsFor', () => {
  it('suggests belonging for a goal about feeling welcome', () => {
    const drafted = draftIndicatorsFor('Everyone who walks in feels welcome');

    expect(drafted[0].category).toBe('belonging');
    // The actual question wording, so an admin judges what will be asked
    // rather than a category name.
    expect(drafted[0].questions.length).toBeGreaterThan(0);
  });

  it('suggests nothing rather than guessing', () => {
    // A co-op shown a confident but irrelevant indicator will approve it, and
    // a plan approved without being read is worse than one with a gap.
    expect(draftIndicatorsFor('Replace the boiler before winter')).toEqual([]);
  });

  it('orders by how well it matched', () => {
    const drafted = draftIndicatorsFor(
      'Members participate regularly and attend often, and some feel they belong',
    );

    expect(drafted[0].category).toBe('participation');
  });

  it('says why, so the suggestion reads as mechanical', () => {
    const [first] = draftIndicatorsFor('People stop feeling lonely');

    expect(first.because).toMatch(/mentions/);
  });
});
