import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from '../scheduler.service';
import { PrismaService } from '../../../config/prisma.service';
import { CommonsService } from '../../commons/commons.service';
import { ReportService } from '../../impact/report.service';

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
            booking: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            impactReport: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
        {
          provide: CommonsService,
          useValue: { closeProposal: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: ReportService,
          useValue: { compose: jest.fn().mockResolvedValue({ status: 'ready' }) },
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
      prisma.proposal.findMany.mockResolvedValue([
        { id: 'p1', channel: { orgId: 'org-a' } },
        { id: 'p2', channel: { orgId: 'org-b' } },
      ] as never);

      const result = await service.runDueTasks(NOW);

      expect(commons.closeProposal).toHaveBeenCalledTimes(2);
      // Each proposal is closed in *its own* org, not in some ambient one:
      // the scheduler crosses org boundaries by reading each row's org and
      // naming it, rather than through an unscoped call (CMN-07).
      expect(commons.closeProposal).toHaveBeenCalledWith('org-a', 'p1');
      expect(commons.closeProposal).toHaveBeenCalledWith('org-b', 'p2');
      expect(result.tasks[0]).toMatchObject({ processed: 2, failed: 0 });
    });

    it('keeps going when one proposal fails, and reports it', async () => {
      prisma.proposal.findMany.mockResolvedValue([
        { id: 'p1', channel: { orgId: 'org-a' } },
        { id: 'boom', channel: { orgId: 'org-a' } },
        { id: 'p3', channel: { orgId: 'org-a' } },
      ] as never);
      commons.closeProposal.mockImplementation(async (_orgId: string, id: string) => {
        if (id === 'boom') throw new Error('deadlock');
        return {} as never;
      });

      const result = await service.runDueTasks(NOW);

      // The two healthy rows must still have been closed.
      expect(commons.closeProposal).toHaveBeenCalledWith('org-a', 'p3');
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

/**
 * Writing the prose for reports waiting on it (IMP-23 phase 2).
 *
 * The scheduler runs this because a composition takes minutes and a
 * synchronous function has seconds. Its job is to be safe rather than fast:
 * nothing may be composed twice, nothing may be stranded, and one report's
 * failure must not stop the next one.
 */
describe('SchedulerService — compose-pending-reports', () => {
  const NOW = new Date('2026-08-27T12:00:00Z');

  const build = async (over: {
    waiting?: Array<{ id: string; orgId: string }>;
    compose?: jest.Mock;
    reclaimed?: number;
  }) => {
    const prisma = {
      proposal: { findMany: jest.fn().mockResolvedValue([]) },
      survey: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      booking: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      impactReport: {
        updateMany: jest.fn().mockResolvedValue({ count: over.reclaimed ?? 0 }),
        findMany: jest.fn().mockResolvedValue(over.waiting ?? []),
      },
    };
    const reports = { compose: over.compose ?? jest.fn().mockResolvedValue({ status: 'ready' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: PrismaService, useValue: prisma },
        { provide: CommonsService, useValue: { closeProposal: jest.fn() } },
        { provide: ReportService, useValue: reports },
      ],
    }).compile();

    return { service: module.get(SchedulerService), prisma, reports };
  };

  const task = (result: any) =>
    result.tasks.find((t: any) => t.task === 'compose-pending-reports');

  it('reclaims a report whose composer died before picking up new ones', async () => {
    // The claim that stops two composers writing the same blocks is also what
    // would strand a report forever if the runner never came back.
    const { service, prisma } = await build({ reclaimed: 1 });

    await service.runDueTasks(NOW);

    expect(prisma.impactReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          composeStatus: 'COMPOSING',
          updatedAt: { lt: new Date(NOW.getTime() - 10 * 60 * 1000) },
        }),
        data: { composeStatus: 'PENDING' },
      }),
    );
  });

  it('only picks up written reports that are waiting', async () => {
    const { service, prisma } = await build({});

    await service.runDueTasks(NOW);

    expect(prisma.impactReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tier: 'WRITTEN', composeStatus: 'PENDING' },
      }),
    );
  });

  it('composes what is waiting, oldest first', async () => {
    const { service, reports } = await build({
      waiting: [
        { id: 'r1', orgId: 'org1' },
        { id: 'r2', orgId: 'org2' },
      ],
    });

    const result = await service.runDueTasks(NOW);

    expect(reports.compose).toHaveBeenCalledWith('org1', 'r1');
    expect(reports.compose).toHaveBeenCalledWith('org2', 'r2');
    expect(task(result).processed).toBe(2);
  });

  it('caps a run so one invocation cannot spend the whole budget', async () => {
    const waiting = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, orgId: 'org1' }));
    const { service, reports } = await build({ waiting });

    await service.runDueTasks(NOW);

    // Three, and the fourth is left for the next run rather than silently
    // dropped — the query asks for one more than the cap so the overflow can
    // be logged instead of guessed at.
    expect(reports.compose).toHaveBeenCalledTimes(3);
  });

  it('counts a report that gave up, without stranding the next one', async () => {
    const compose = jest
      .fn()
      .mockResolvedValueOnce({ status: 'failed', note: 'kept breaking the rules' })
      .mockResolvedValueOnce({ status: 'ready' });

    const { service } = await build({
      waiting: [
        { id: 'r1', orgId: 'org1' },
        { id: 'r2', orgId: 'org2' },
      ],
      compose,
    });

    const result = await service.runDueTasks(NOW);

    expect(task(result).failed).toBe(1);
    expect(task(result).processed).toBe(1);
    expect(task(result).errors[0]).toContain('kept breaking the rules');
  });

  it('keeps going when one report throws outright', async () => {
    const compose = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ status: 'ready' });

    const { service } = await build({
      waiting: [
        { id: 'r1', orgId: 'org1' },
        { id: 'r2', orgId: 'org2' },
      ],
      compose,
    });

    const result = await service.runDueTasks(NOW);

    expect(compose).toHaveBeenCalledTimes(2);
    expect(task(result).processed).toBe(1);
    expect(task(result).failed).toBe(1);
  });
});
