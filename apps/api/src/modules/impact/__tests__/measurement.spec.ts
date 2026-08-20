import { Test, TestingModule } from '@nestjs/testing';
import { ImpactService } from '../impact.service';
import { PrismaService } from '../../../config/prisma.service';
import { STARTER_QUESTIONS } from '../starter-instrument';

/**
 * Turning collection on for a co-op (IMP-18).
 *
 * The behaviour that matters is idempotence. Two overlapping baselines would
 * mean two open collection windows, and an answer that could belong to either
 * is an answer that traces to neither — which is G5, the guarantee the whole
 * report rests on.
 */
describe('ImpactService — starting to measure', () => {
  let service: ImpactService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-1' }) },
      survey: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'survey-1' }),
        update: jest.fn().mockResolvedValue({ id: 'survey-1' }),
      },
      surveyQuestion: { upsert: jest.fn().mockResolvedValue({}) },
      collectionWindow: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'window-1', label: '2026 baseline' }),
      },
      surveyAnswer: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ImpactService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ImpactService>(ImpactService);
  });

  it('installs every question and opens one window', async () => {
    const result = await service.startMeasuring('org-1');

    expect(prisma.survey.create).toHaveBeenCalled();
    expect(prisma.surveyQuestion.upsert).toHaveBeenCalledTimes(STARTER_QUESTIONS.length);
    expect(prisma.collectionWindow.create).toHaveBeenCalledTimes(1);
    expect(result.windowId).toBe('window-1');
  });

  it('publishes the survey, since an unpublished one is never asked', async () => {
    await service.startMeasuring('org-1');

    const { data } = prisma.survey.create.mock.calls[0][0];
    // `nextAskFor` filters on isActive AND publishedAt — installing without
    // both would look like success and ask nobody anything.
    expect(data.isActive).toBe(true);
    expect(data.publishedAt).toBeInstanceOf(Date);
  });

  it('does not open a second window when one is already open', async () => {
    prisma.survey.findFirst.mockResolvedValue({ id: 'survey-1' });
    prisma.collectionWindow.findFirst.mockResolvedValue({ id: 'window-0', label: '2026 baseline' });

    const result = await service.startMeasuring('org-1');

    expect(prisma.survey.create).not.toHaveBeenCalled();
    expect(prisma.collectionWindow.create).not.toHaveBeenCalled();
    expect(result.windowId).toBe('window-0');
  });

  it('re-enables a paused co-op without duplicating anything', async () => {
    prisma.survey.findFirst.mockResolvedValue({ id: 'survey-1' });
    prisma.collectionWindow.findFirst.mockResolvedValue({ id: 'window-0', label: '2026 baseline' });

    await service.startMeasuring('org-1');

    expect(prisma.survey.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }),
    );
  });

  it('stopping keeps the window open, so answers already given still count', async () => {
    prisma.survey.findFirst.mockResolvedValue({ id: 'survey-1' });

    await service.stopMeasuring('org-1');

    expect(prisma.survey.update).toHaveBeenCalledWith({
      where: { id: 'survey-1' },
      data: { isActive: false },
    });
    // A co-op pausing for a month must not lose the months before it.
    expect(prisma.collectionWindow.create).not.toHaveBeenCalled();
  });

  it('shows an admin the questions before any are installed', async () => {
    // The decision being made is "shall we put these to our members", and it
    // cannot be made without reading them.
    const status = await service.measurementStatus('org-1');

    expect(status.installed).toBe(false);
    expect(status.collecting).toBe(false);
    expect(status.questions).toHaveLength(STARTER_QUESTIONS.length);
    expect(status.questions[0].text.length).toBeGreaterThan(0);
  });
});
