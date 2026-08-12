import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ImpactService } from '../impact.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * The response schema (IMP-05, IMP-08, IMP-09).
 *
 * The audit found that ImpactOS accepted an entirely empty answer set against
 * five required questions, accepted responses to surveys that had never been
 * published and to ones already closed, accepted the same member's answers
 * without limit, and could not compute a single metric from any of it.
 *
 * These tests pin the rules that replaced that. They are written against the
 * *reasons* rather than the implementation: a member cannot answer a survey
 * that is not open, cannot answer it twice in a round, cannot skip a required
 * question, and cannot submit a value the question does not accept.
 */
describe('ImpactService — submitting a response', () => {
  let service: ImpactService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';
  const SURVEY = 'survey-1';

  const openSurvey = {
    id: SURVEY,
    orgId: ORG,
    isActive: true,
    publishedAt: new Date('2026-01-01'),
    closesAt: null,
  };

  const openWindow = {
    id: 'window-1',
    surveyId: SURVEY,
    label: '2026 baseline',
    opensAt: new Date('2026-01-01'),
    closesAt: null,
  };

  const questions = [
    { id: 'q-belonging', key: 'belonging', type: 'SCALE', options: [], category: 'belonging', required: true },
    { id: 'q-network', key: 'network_size', type: 'NUMBER', options: [], category: 'network_size', required: false },
    { id: 'q-participation', key: 'participation', type: 'CHOICE', options: ['Never', 'Weekly'], category: 'participation', required: false },
    { id: 'q-open', key: 'what_it_means', type: 'TEXT', options: [], category: 'belonging', required: false },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpactService,
        {
          provide: PrismaService,
          useValue: {
            survey: { findFirst: jest.fn().mockResolvedValue(openSurvey) },
            collectionWindow: { findFirst: jest.fn().mockResolvedValue(openWindow) },
            surveyQuestion: { findMany: jest.fn().mockResolvedValue(questions) },
            surveyResponse: { create: jest.fn().mockResolvedValue({ id: 'response-1' }) },
          },
        },
      ],
    }).compile();

    service = module.get<ImpactService>(ImpactService);
    prisma = module.get(PrismaService);
  });

  const submit = (answers: Record<string, unknown>) =>
    service.submitResponse(ORG, SURVEY, 'user-1', answers);

  describe('IMP-09 — only while the survey is open', () => {
    it('refuses a survey that was never published', async () => {
      prisma.survey.findFirst.mockResolvedValue({
        ...openSurvey,
        isActive: false,
        publishedAt: null,
      } as never);

      await expect(submit({ belonging: 4 })).rejects.toThrow(BadRequestException);
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
    });

    it('refuses a survey that has been closed', async () => {
      prisma.survey.findFirst.mockResolvedValue({ ...openSurvey, isActive: false } as never);

      await expect(submit({ belonging: 4 })).rejects.toThrow(BadRequestException);
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
    });

    it('refuses when no collection window is open', async () => {
      prisma.collectionWindow.findFirst.mockResolvedValue(null);

      await expect(submit({ belonging: 4 })).rejects.toThrow(
        /no open collection window/i,
      );
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
    });

    it('only considers windows that have opened and have not closed', async () => {
      await submit({ belonging: 4 });

      const where = prisma.collectionWindow.findFirst.mock.calls[0][0].where;
      expect(where.surveyId).toBe(SURVEY);
      expect(where.opensAt).toHaveProperty('lte');
      expect(where.OR).toEqual([{ closesAt: null }, { closesAt: { gt: expect.any(Date) } }]);
    });
  });

  describe('IMP-08 — one response per member per window', () => {
    it('files the response against the open window', async () => {
      await submit({ belonging: 4 });

      expect(prisma.surveyResponse.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ windowId: 'window-1', userId: 'user-1' }),
        }),
      );
    });

    it('turns the unique-constraint violation into a 409, not a 500', async () => {
      prisma.surveyResponse.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(submit({ belonging: 4 })).rejects.toThrow(ConflictException);
      await expect(submit({ belonging: 4 })).rejects.toThrow(/2026 baseline/);
    });

    it('does not swallow other database errors', async () => {
      prisma.surveyResponse.create.mockRejectedValue(new Error('connection lost'));

      await expect(submit({ belonging: 4 })).rejects.toThrow('connection lost');
    });
  });

  describe('answers are validated against the questions as defined', () => {
    it('rejects an empty answer set', async () => {
      await expect(submit({})).rejects.toThrow(/required/i);
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
    });

    it('rejects a missing required answer', async () => {
      await expect(submit({ network_size: 4 })).rejects.toThrow(/belonging/);
    });

    it('rejects an unknown question key', async () => {
      await expect(submit({ belonging: 4, nonsense: 1 })).rejects.toThrow(/nonsense/);
    });

    it.each([[0], [6], [2.5], ['abc']])('rejects %p as a 1-5 scale', async (value) => {
      await expect(submit({ belonging: value })).rejects.toThrow(/scale/i);
    });

    it('rejects a choice that is not one of the options', async () => {
      await expect(
        submit({ belonging: 4, participation: 'Hourly' }),
      ).rejects.toThrow(/not an option/);
    });

    it('accepts a value the question does allow', async () => {
      await submit({ belonging: 4, participation: 'Weekly' });
      expect(prisma.surveyResponse.create).toHaveBeenCalled();
    });
  });

  describe('IMP-05 — answers are stored typed, and carry their category', () => {
    it('writes a scale into numericValue with its category', async () => {
      await submit({ belonging: 4 });

      const answers = prisma.surveyResponse.create.mock.calls[0][0].data.answers.create;
      expect(answers).toEqual([
        expect.objectContaining({
          question: { connect: { id: 'q-belonging' } },
          category: 'belonging',
          numericValue: 4,
        }),
      ]);
    });

    it('puts each type in its own column, never a JSON blob', async () => {
      await submit({
        belonging: 5,
        network_size: 12,
        participation: 'Weekly',
        what_it_means: 'people who show up',
      });

      const answers = prisma.surveyResponse.create.mock.calls[0][0].data.answers.create;
      expect(answers).toEqual([
        expect.objectContaining({ numericValue: 5, category: 'belonging' }),
        expect.objectContaining({ numericValue: 12, category: 'network_size' }),
        expect.objectContaining({ choiceValue: 'Weekly', category: 'participation' }),
        expect.objectContaining({ textValue: 'people who show up', category: 'belonging' }),
      ]);
      // The bug this replaces: an answer keyed by question id, with the
      // category living only on the question definition, so the aggregation
      // averaged names nothing had written.
      for (const a of answers) {
        expect(a).toHaveProperty('question.connect.id');
      }
    });

    it('omits an unanswered optional question rather than storing a blank', async () => {
      await submit({ belonging: 4 });

      const answers = prisma.surveyResponse.create.mock.calls[0][0].data.answers.create;
      expect(answers).toHaveLength(1);
    });
  });
});

describe('ImpactService — question versioning', () => {
  let service: ImpactService;
  let prisma: jest.Mocked<PrismaService>;
  let tx: Record<string, { update: jest.Mock; create: jest.Mock }>;

  const ORG = 'org-1';
  const SURVEY = 'survey-1';

  const existing = {
    id: 'q1',
    surveyId: SURVEY,
    key: 'belonging',
    version: 1,
    text: 'How often do you feel you belong?',
    type: 'SCALE',
    options: [] as string[],
    category: 'belonging',
    required: true,
    sortOrder: 0,
  };

  beforeEach(async () => {
    tx = {
      surveyQuestion: { update: jest.fn(), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpactService,
        {
          provide: PrismaService,
          useValue: {
            survey: {
              findFirst: jest.fn().mockResolvedValue({ id: SURVEY, orgId: ORG }),
              update: jest.fn().mockResolvedValue({}),
            },
            surveyQuestion: { findMany: jest.fn().mockResolvedValue([existing]) },
            $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
          },
        },
      ],
    }).compile();

    service = module.get<ImpactService>(ImpactService);
    prisma = module.get(PrismaService);
  });

  it('retires the old version and writes a new one when wording changes', async () => {
    await service.updateSurvey(ORG, SURVEY, {
      questions: [{ ...existing, text: 'Do you feel you belong here?' } as never],
    });

    expect(tx.surveyQuestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q1' },
        data: { retiredAt: expect.any(Date) },
      }),
    );
    expect(tx.surveyQuestion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ key: 'belonging', version: 2 }),
      }),
    );
  });

  it('does not version an unchanged question', async () => {
    await service.updateSurvey(ORG, SURVEY, { questions: [{ ...existing } as never] });

    expect(tx.surveyQuestion.create).not.toHaveBeenCalled();
  });

  it('retires a question dropped from the survey instead of deleting it', async () => {
    await service.updateSurvey(ORG, SURVEY, {
      questions: [
        { key: 'something_else', text: 'New question', type: 'TEXT' } as never,
      ],
    });

    expect(tx.surveyQuestion.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { retiredAt: expect.any(Date) },
    });
  });
});
