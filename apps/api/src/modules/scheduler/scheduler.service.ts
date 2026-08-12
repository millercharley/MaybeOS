import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CommonsService } from '../commons/commons.service';

export interface TaskResult {
  task: string;
  processed: number;
  failed: number;
  errors: string[];
}

export interface RunResult {
  startedAt: string;
  durationMs: number;
  tasks: TaskResult[];
}

/**
 * Work that has to happen because a moment arrived rather than because
 * somebody clicked something (D-022).
 *
 * Design constraints worth keeping:
 *
 * - **Due-at lives on the row, not in a queue.** There is no jobs table.
 *   Each task asks the database "what is overdue right now?" and acts. A
 *   missed run therefore costs lateness, never loss: the next run picks up
 *   everything still outstanding. This is what makes a serverless scheduler
 *   safe after D-007 removed the only real queue.
 * - **Every task is idempotent.** Tasks filter on the state they are about
 *   to leave behind (`status: OPEN`, `isActive: true`), so running twice
 *   over the same row is a no-op, and a retried or double-fired invocation
 *   cannot double-apply anything.
 * - **One task's failure must not strand the others.** Each row is handled
 *   independently and errors are collected, not thrown.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly commons: CommonsService,
  ) {}

  async runDueTasks(now: Date = new Date()): Promise<RunResult> {
    const startedAt = new Date();

    // Each task is isolated: a task that cannot even run its query — a lost
    // connection, a schema drift — must not stop the tasks after it. Without
    // this the tasks would be coupled by their order in this array, which is
    // an accident waiting to be debugged at 2am.
    const tasks: TaskResult[] = [];
    for (const task of [
      { name: 'close-due-proposals', run: () => this.closeDueProposals(now) },
      { name: 'close-due-surveys', run: () => this.closeDueSurveys(now) },
    ]) {
      try {
        tasks.push(await task.run());
      } catch (error) {
        const message = (error as Error).message;
        this.logger.error(`Task ${task.name} failed outright`, error as Error);
        tasks.push({ task: task.name, processed: 0, failed: 1, errors: [message] });
      }
    }

    const result: RunResult = {
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      tasks,
    };

    const processed = tasks.reduce((n, t) => n + t.processed, 0);
    const failed = tasks.reduce((n, t) => n + t.failed, 0);
    this.logger.log(
      `Scheduled run complete: ${processed} processed, ${failed} failed, ${result.durationMs}ms`,
    );

    return result;
  }

  /**
   * Close proposals whose voting deadline has passed.
   *
   * `Proposal.closesAt` has always been written and never read: a proposal
   * past its deadline stayed OPEN indefinitely, and CommonsOS is a shipped
   * module people actually use, so a governance vote could sit "open" for
   * months after it was supposed to have ended.
   *
   * Delegates to `CommonsService.closeProposal`, which already applies the
   * quorum and majority rules and writes PASSED or FAILED. Reimplementing
   * the tally here would create a second, drifting definition of whether a
   * proposal passed — the outcome must not depend on whether a human or the
   * clock closed it.
   */
  private async closeDueProposals(now: Date): Promise<TaskResult> {
    const due = await this.prisma.proposal.findMany({
      where: { status: 'OPEN', closesAt: { not: null, lte: now } },
      select: { id: true },
    });

    const result: TaskResult = {
      task: 'close-due-proposals',
      processed: 0,
      failed: 0,
      errors: [],
    };

    for (const { id } of due) {
      try {
        await this.commons.closeProposal(id);
        result.processed++;
      } catch (error) {
        result.failed++;
        result.errors.push(`${id}: ${(error as Error).message}`);
        this.logger.error(`Failed to close proposal ${id}`, error as Error);
      }
    }

    return result;
  }

  /**
   * Deactivate surveys whose closing date has passed.
   *
   * Same shape as the proposals case: `Survey.closesAt` is written by the
   * create and update paths and read by nothing, so a survey advertised as
   * closing on a date stayed open forever.
   *
   * This is deliberately *not* the whole of IMP-09. The API still accepts a
   * response to a closed or unpublished survey, because `submitResponse`
   * does not check `isActive`. Closing on time narrows the window; the
   * submit-side check is the actual fix and belongs with the response
   * schema work.
   */
  private async closeDueSurveys(now: Date): Promise<TaskResult> {
    const result: TaskResult = {
      task: 'close-due-surveys',
      processed: 0,
      failed: 0,
      errors: [],
    };

    try {
      const { count } = await this.prisma.survey.updateMany({
        where: { isActive: true, closesAt: { not: null, lte: now } },
        data: { isActive: false },
      });
      result.processed = count;
    } catch (error) {
      result.failed++;
      result.errors.push((error as Error).message);
      this.logger.error('Failed to close due surveys', error as Error);
    }

    return result;
  }
}
