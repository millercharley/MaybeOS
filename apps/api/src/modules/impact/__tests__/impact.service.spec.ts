import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ImpactService } from '../impact.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Tenant isolation for ImpactOS (IMP-01).
 *
 * On 2026-08-11 an admin of one co-op could read, retitle and publish another
 * co-op's survey by pairing their own org id — which the org guard checks —
 * with a survey id belonging to somebody else, which nothing checked. Every
 * survey lookup now filters on both.
 *
 * These tests assert the filter reaches Prisma. A survey that exists but
 * belongs to another org is indistinguishable from one that does not exist:
 * `findFirst` returns null either way, and both raise NotFound.
 */
describe('ImpactService — tenant isolation', () => {
  let service: ImpactService;
  let prisma: jest.Mocked<PrismaService>;

  const OWN_ORG = 'org-sunrise';
  const SURVEY = 'survey-1';

  const mockSurvey = {
    id: SURVEY,
    orgId: OWN_ORG,
    title: 'Baseline Community Wellbeing Survey',
    description: null,
    type: 'BASELINE',
    questions: [],
    isActive: true,
    publishedAt: new Date(),
    closesAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpactService,
        {
          provide: PrismaService,
          useValue: {
            survey: {
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            surveyResponse: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<ImpactService>(ImpactService);
    prisma = module.get(PrismaService);
  });

  describe('when the survey belongs to another org', () => {
    beforeEach(() => {
      // What Prisma returns once the orgId filter is applied.
      prisma.survey.findFirst.mockResolvedValue(null);
    });

    it('getSurvey raises NotFound', async () => {
      await expect(service.getSurvey('org-someone-else', SURVEY)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updateSurvey raises NotFound and writes nothing', async () => {
      await expect(
        service.updateSurvey('org-someone-else', SURVEY, { title: 'Retitled' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('publishSurvey raises NotFound and writes nothing', async () => {
      await expect(service.publishSurvey('org-someone-else', SURVEY)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('closeSurvey raises NotFound and writes nothing', async () => {
      await expect(service.closeSurvey('org-someone-else', SURVEY)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.survey.update).not.toHaveBeenCalled();
    });

    it('submitResponse raises NotFound and stores nothing', async () => {
      await expect(
        service.submitResponse('org-someone-else', SURVEY, 'user-1', { q1: 5 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.surveyResponse.create).not.toHaveBeenCalled();
    });
  });

  describe('every survey lookup filters on orgId', () => {
    beforeEach(() => {
      prisma.survey.findFirst.mockResolvedValue(mockSurvey);
      prisma.survey.update.mockResolvedValue(mockSurvey);
      prisma.surveyResponse.create.mockResolvedValue({ id: 'response-1' });
    });

    // The regression this file exists to prevent is a lookup by bare id, so
    // assert the shape of the query rather than only its result.
    const expectScopedLookup = () => {
      expect(prisma.survey.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: SURVEY, orgId: OWN_ORG }),
        }),
      );
    };

    it('getSurvey', async () => {
      await service.getSurvey(OWN_ORG, SURVEY);
      expectScopedLookup();
    });

    it('updateSurvey', async () => {
      await service.updateSurvey(OWN_ORG, SURVEY, { title: 'New title' });
      expectScopedLookup();
      expect(prisma.survey.update).toHaveBeenCalled();
    });

    it('publishSurvey', async () => {
      await service.publishSurvey(OWN_ORG, SURVEY);
      expectScopedLookup();
    });

    it('closeSurvey', async () => {
      await service.closeSurvey(OWN_ORG, SURVEY);
      expectScopedLookup();
    });

    it('submitResponse', async () => {
      await service.submitResponse(OWN_ORG, SURVEY, 'user-1', { q1: 5 });
      expectScopedLookup();
      expect(prisma.surveyResponse.create).toHaveBeenCalled();
    });
  });
});
