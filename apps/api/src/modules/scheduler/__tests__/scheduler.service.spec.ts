import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from '../scheduler.service';
import { PrismaService } from '../../../config/prisma.service';
import { CommonsService } from '../../commons/commons.service';

/**
 * The scheduler's correctness is mostly about what it *doesn't* touch: rows
 * that aren't due, rows already in their target state, and other rows after
 * one of them throws. These tests pin the query filters and the failure
 * isolation, since a scheduled job that quietly closes the wrong thing has
 * no user watching it happen.
 */
describe('SchedulerService', () => {
  let service: SchedulerService;
  let prisma: jest.Mocked<PrismaService>;
  let commons: jest.Mocked<CommonsService>;

  const NOW = new Date('2026-08-11T12:00:00Z');

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        {
          provide: PrismaService,
          useValue: {
            proposal: { findMany: jest.fn().mockResolvedValue([]) },
            survey: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          },
        },
        {
          provide: CommonsService,
          useValue: { closeProposal: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
    prisma = module.get(PrismaService);
    commons = module.get(CommonsService);
  });

  describe('close-due-proposals', () => {
    it('only selects OPEN proposals with a deadline at or before now', async () => {
      await service.runDueTasks(NOW);

      expect(prisma.proposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'OPEN', closesAt: { not: null, lte: NOW } },
        }),
      );
    });

    it('delegates to CommonsService so the quorum rule is not duplicated', async () => {
      prisma.proposal.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);

      const result = await service.runDueTasks(NOW);

      expect(commons.closeProposal).toHaveBeenCalledTimes(2);
      expect(commons.closeProposal).toHaveBeenCalledWith('p1');
      expect(commons.closeProposal).toHaveBeenCalledWith('p2');
      expect(result.tasks[0]).toMatchObject({ processed: 2, failed: 0 });
    });

    it('keeps going when one proposal fails, and reports it', async () => {
      prisma.proposal.findMany.mockResolvedValue([
        { id: 'p1' },
        { id: 'boom' },
        { id: 'p3' },
      ] as never);
      commons.closeProposal.mockImplementation(async (id: string) => {
        if (id === 'boom') throw new Error('deadlock');
        return {} as never;
      });

      const result = await service.runDueTasks(NOW);

      // The two healthy rows must still have been closed.
      expect(commons.closeProposal).toHaveBeenCalledWith('p3');
      expect(result.tasks[0]).toMatchObject({ processed: 2, failed: 1 });
      expect(result.tasks[0].errors[0]).toContain('boom');
    });

    it('does not strand the survey task when the proposal query itself fails', async () => {
      prisma.proposal.findMany.mockRejectedValue(new Error('connection lost'));
      prisma.survey.updateMany.mockResolvedValue({ count: 3 } as never);

      const result = await service.runDueTasks(NOW);

      // The run reports the failure rather than throwing, and the surveys
      // still get closed — otherwise the two tasks would be coupled purely
      // by their order in the list.
      expect(result.tasks[0]).toMatchObject({ processed: 0, failed: 1 });
      expect(result.tasks[0].errors[0]).toContain('connection lost');
      expect(result.tasks[1]).toMatchObject({ processed: 3, failed: 0 });
    });
  });

  describe('close-due-surveys', () => {
    it('only deactivates active surveys whose deadline has passed', async () => {
      await service.runDueTasks(NOW);

      expect(prisma.survey.updateMany).toHaveBeenCalledWith({
        where: { isActive: true, closesAt: { not: null, lte: NOW } },
        data: { isActive: false },
      });
    });

    it('reports how many it closed', async () => {
      prisma.survey.updateMany.mockResolvedValue({ count: 4 } as never);

      const result = await service.runDueTasks(NOW);

      expect(result.tasks[1]).toMatchObject({
        task: 'close-due-surveys',
        processed: 4,
        failed: 0,
      });
    });
  });

  it('reports nothing to do when nothing is due', async () => {
    const result = await service.runDueTasks(NOW);

    expect(result.tasks.every((t) => t.processed === 0 && t.failed === 0)).toBe(true);
    expect(commons.closeProposal).not.toHaveBeenCalled();
  });
});
