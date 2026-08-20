import { Test, TestingModule } from '@nestjs/testing';
import { ImpactService } from '../impact.service';
import { PrismaService } from '../../../config/prisma.service';
import { SUPPRESSION_THRESHOLD } from '../demographics';

/**
 * What a co-op is shown about itself (IMP-20).
 *
 * The rule under test is §10: individual responses are never exposed to
 * admins. `getDashboard` averaged a category however few answers it had, so a
 * category answered by one person reported that person's answer as the
 * co-op's score — which is an individual response wearing an average's
 * clothes, and it was already live.
 */
describe('ImpactService — signals', () => {
  let service: ImpactService;
  let prisma: any;

  const answersFrom = (category: string, userIds: (string | null)[]) =>
    userIds.map((userId) => ({ category, response: { userId } }));

  beforeEach(async () => {
    prisma = {
      collectionWindow: { findMany: jest.fn().mockResolvedValue([]) },
      userOrg: { count: jest.fn().mockResolvedValue(20) },
      surveyQuestion: { findMany: jest.fn().mockResolvedValue([]) },
      surveyAnswer: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ImpactService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ImpactService>(ImpactService);
  });

  const withCategory = (category: string, people: number, avg: number) => {
    prisma.surveyAnswer.groupBy.mockResolvedValue([
      { category, _avg: { numericValue: avg }, _count: { numericValue: people } },
    ]);
    prisma.surveyAnswer.findMany.mockResolvedValue(
      answersFrom(category, Array.from({ length: people }, (_, i) => `user-${i}`)),
    );
  };

  describe('suppression', () => {
    it('withholds the average when too few people answered', async () => {
      withCategory('belonging', SUPPRESSION_THRESHOLD - 1, 4.5);

      const { categories } = await service.getSignals('org-1');

      // The number itself is withheld, not merely flagged: a suppressed cell
      // that still ships the figure has suppressed nothing.
      expect(categories[0].average).toBeNull();
      expect(categories[0].reportable).toBe(false);
      // The count is safe to show and is what tells an admin to keep going.
      expect(categories[0].respondents).toBe(SUPPRESSION_THRESHOLD - 1);
    });

    it('reports it at the threshold', async () => {
      withCategory('belonging', SUPPRESSION_THRESHOLD, 4.5);

      const { categories } = await service.getSignals('org-1');

      expect(categories[0].average).toBe(4.5);
      expect(categories[0].reportable).toBe(true);
    });

    it('counts people, not answers', async () => {
      // One member answering the same category at four touchpoints is one
      // person. Counting answers would clear the threshold with a single
      // respondent and publish their answer as the co-op's score.
      prisma.surveyAnswer.groupBy.mockResolvedValue([
        { category: 'belonging', _avg: { numericValue: 4.5 }, _count: { numericValue: 8 } },
      ]);
      prisma.surveyAnswer.findMany.mockResolvedValue(
        answersFrom('belonging', ['user-1', 'user-1', 'user-1', 'user-1', 'user-1', 'user-1', 'user-1', 'user-1']),
      );

      const { categories } = await service.getSignals('org-1');

      expect(categories[0].respondents).toBe(1);
      expect(categories[0].average).toBeNull();
      // The answer count is still reported honestly — it is the respondent
      // count that governs.
      expect(categories[0].answerCount).toBe(8);
    });

    it('treats anonymous answers as distinct people', async () => {
      // There is no identity to collapse them by, which is the same reasoning
      // the one-response-per-window index uses.
      prisma.surveyAnswer.groupBy.mockResolvedValue([
        { category: 'belonging', _avg: { numericValue: 3 }, _count: { numericValue: 5 } },
      ]);
      prisma.surveyAnswer.findMany.mockResolvedValue(
        answersFrom('belonging', [null, null, null, null, null]),
      );

      const { categories } = await service.getSignals('org-1');

      expect(categories[0].respondents).toBe(5);
    });

    it('publishes the threshold it used', async () => {
      const signals = await service.getSignals('org-1');

      // Surfaced rather than hardcoded in UI copy, so the promise a member is
      // shown and the rule the figures obey are the same number.
      expect(signals.suppressionThreshold).toBe(SUPPRESSION_THRESHOLD);
    });
  });

  describe('direction', () => {
    it('carries which way is good news', async () => {
      prisma.surveyQuestion.findMany.mockResolvedValue([
        { category: 'loneliness', higherIsBetter: false },
        { category: 'belonging', higherIsBetter: true },
      ]);
      prisma.surveyAnswer.groupBy.mockResolvedValue([
        { category: 'loneliness', _avg: { numericValue: 4.2 }, _count: { numericValue: 6 } },
      ]);
      prisma.surveyAnswer.findMany.mockResolvedValue(
        answersFrom('loneliness', ['a', 'b', 'c', 'd', 'e', 'f']),
      );

      const { categories } = await service.getSignals('org-1');

      // 4.2 belonging and 4.2 loneliness are opposite results.
      expect(categories[0].higherIsBetter).toBe(false);
    });

    it('assumes higher is better where nothing says otherwise', async () => {
      withCategory('participation', 6, 3.1);

      const { categories } = await service.getSignals('org-1');

      expect(categories[0].higherIsBetter).toBe(true);
    });
  });

  describe('windows', () => {
    it('reports a response rate against the membership', async () => {
      prisma.collectionWindow.findMany.mockResolvedValue([
        {
          id: 'w1',
          label: '2026 baseline',
          opensAt: new Date('2026-01-01'),
          closesAt: null,
          _count: { responses: 5 },
        },
      ]);

      const { windows } = await service.getSignals('org-1');

      expect(windows[0].responseRate).toBe(25); // 5 of 20 members
    });
  });

  describe("a member's own view", () => {
    it('gives a member the same suppressed figures an organiser sees', async () => {
      withCategory('belonging', 2, 5);
      // Both reads go through surveyAnswer.findMany, so the mock has to tell
      // them apart the way the service does — by what it selects.
      prisma.surveyAnswer.findMany.mockImplementation((args: any) =>
        args?.select?.question
          ? Promise.resolve([])
          : Promise.resolve(answersFrom('belonging', ['user-1', 'user-2'])),
      );

      const mine = await service.myImpact('org-1', 'user-1');

      // No looser view for members: a small cell is a small cell whoever asks.
      expect(mine.community.categories[0].average).toBeNull();
    });
  });
});
