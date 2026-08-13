import { Test, TestingModule } from '@nestjs/testing';
import { TouchpointService } from '../touchpoint.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * The ticket-purchase touchpoint (IMP-15, PRD §6.2).
 *
 * This was P0 in the PRD and impossible until EVT-06 shipped ticketing —
 * `Event` had no price field, so the moment the question attaches to did not
 * exist. What these cover is the part that can go quietly wrong: asking a
 * member who should not have been asked.
 */
describe('TouchpointService', () => {
  let service: TouchpointService;
  let prisma: any;

  const membership = (over: Record<string, unknown> = {}) => ({
    lastAskedAt: null,
    askDismissals: 0,
    ...over,
  });

  const question = {
    id: 'q-1',
    surveyId: 'survey-1',
    text: 'How did that feel?',
    type: 'SCALE',
    options: [],
    category: 'belonging',
    survey: { id: 'survey-1' },
  };

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findUnique: jest.fn().mockResolvedValue(membership()),
        update: jest.fn().mockResolvedValue({}),
      },
      surveyQuestion: {
        findMany: jest.fn().mockResolvedValue([question]),
        findFirst: jest.fn().mockResolvedValue(question),
      },
      surveyAnswer: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      collectionWindow: { findFirst: jest.fn().mockResolvedValue({ id: 'window-1' }) },
      surveyResponse: { upsert: jest.fn().mockResolvedValue({ id: 'response-1' }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TouchpointService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TouchpointService>(TouchpointService);
  });

  describe('who gets asked', () => {
    it('asks a member who is due', async () => {
      const ask = await service.nextAskFor('org-1', 'user-1', 'TICKET_PURCHASE' as any);

      expect(ask?.text).toBe('How did that feel?');
    });

    it('asks nothing when the member is inside their window', async () => {
      // The ordinary case. Most purchases must ask nothing at all.
      prisma.userOrg.findUnique.mockResolvedValue(
        membership({ lastAskedAt: new Date(Date.now() - 5 * 86_400_000) }),
      );

      expect(await service.nextAskFor('org-1', 'user-1', 'TICKET_PURCHASE' as any)).toBeNull();
    });

    it('asks nothing once a member has dismissed three times', async () => {
      prisma.userOrg.findUnique.mockResolvedValue(
        membership({ lastAskedAt: new Date(Date.now() - 100 * 86_400_000), askDismissals: 3 }),
      );

      expect(await service.nextAskFor('org-1', 'user-1', 'TICKET_PURCHASE' as any)).toBeNull();
    });

    it('never asks a non-member', async () => {
      prisma.userOrg.findUnique.mockResolvedValue(null);

      expect(await service.nextAskFor('org-1', 'stranger', 'TICKET_PURCHASE' as any)).toBeNull();
    });

    it('only draws from published surveys in this org', async () => {
      await service.nextAskFor('org-1', 'user-1', 'TICKET_PURCHASE' as any);

      const where = prisma.surveyQuestion.findMany.mock.calls[0][0].where;
      expect(where.survey).toEqual({ orgId: 'org-1', isActive: true, publishedAt: { not: null } });
      expect(where.touchpoint).toBe('TICKET_PURCHASE');
      expect(where.retiredAt).toBeNull();
    });

    it('does not ask the same question twice in one window', async () => {
      // The budget stops a member being asked often; this stops them being
      // asked the identical question again inside the same window.
      prisma.surveyAnswer.findMany.mockResolvedValue([{ questionId: 'q-1' }]);

      expect(await service.nextAskFor('org-1', 'user-1', 'TICKET_PURCHASE' as any)).toBeNull();
    });

    it('asks nothing when the co-op has attached no question here', async () => {
      prisma.surveyQuestion.findMany.mockResolvedValue([]);

      expect(await service.nextAskFor('org-1', 'user-1', 'TICKET_PURCHASE' as any)).toBeNull();
    });
  });

  describe('answering', () => {
    it('adds to the member’s response for the window rather than starting another', async () => {
      // One response per member per collection window is what keeps G5 true:
      // every figure traces to a response count and a window.
      await service.recordAnswer('org-1', 'user-1', 'q-1', 4);

      expect(prisma.surveyResponse.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { windowId_userId: { windowId: 'window-1', userId: 'user-1' } },
        }),
      );
    });

    it('stores a scale answer as a number, not a string', async () => {
      await service.recordAnswer('org-1', 'user-1', 'q-1', '4');

      const created = prisma.surveyAnswer.upsert.mock.calls[0][0].create;
      expect(created.numericValue).toBe(4);
      expect(created.category).toBe('belonging');
    });

    it('spends the budget, so the next touchpoint asks nothing', async () => {
      await service.recordAnswer('org-1', 'user-1', 'q-1', 4);

      const data = prisma.userOrg.update.mock.calls[0][0].data;
      expect(data.lastAskedAt).toBeInstanceOf(Date);
      expect(data.askDismissals).toBe(0);
    });

    it('refuses a question belonging to another co-op', async () => {
      prisma.surveyQuestion.findFirst.mockResolvedValue(null);

      await expect(service.recordAnswer('org-1', 'user-1', 'q-x', 4)).rejects.toThrow();
    });

    it('refuses when no collection window is open', async () => {
      // Without a window the answer could not be traced to one, and G5 says
      // every figure must be.
      prisma.collectionWindow.findFirst.mockResolvedValue(null);

      await expect(service.recordAnswer('org-1', 'user-1', 'q-1', 4)).rejects.toThrow();
    });
  });

  describe('dismissal', () => {
    it('counts it and restarts the clock', async () => {
      await service.dismiss('org-1', 'user-1');

      const data = prisma.userOrg.update.mock.calls[0][0].data;
      expect(data.askDismissals).toBe(1);
      expect(data.lastAskedAt).toBeInstanceOf(Date);
    });

    it('widens the window on the third, and keeps it widened', async () => {
      prisma.userOrg.findUnique.mockResolvedValue(membership({ askDismissals: 2 }));

      await service.dismiss('org-1', 'user-1');

      expect(prisma.userOrg.update.mock.calls[0][0].data.askDismissals).toBe(3);
    });
  });
});
