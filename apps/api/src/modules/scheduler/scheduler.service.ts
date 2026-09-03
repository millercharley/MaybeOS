import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CommonsService } from '../commons/commons.service';
import { ReportService } from '../impact/report.service';
import { BuddyService } from '../belonging/buddy.service';
import { HostBriefingService } from '../service/host-briefing.service';

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
    private readonly reports: ReportService,
    private readonly buddies: BuddyService,
    private readonly hosting: HostBriefingService,
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
      { name: 'release-expired-booking-holds', run: () => this.releaseExpiredHolds(now) },
      { name: 'compose-pending-reports', run: () => this.composePendingReports(now) },
      { name: 'advance-buddy-pairings', run: () => this.advanceBuddyPairings(now) },
      { name: 'send-host-briefings', run: () => this.sendHostBriefings(now) },
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
   * Tell hosts what they have to do around their booking (SRV-03).
   *
   * Nothing is sent until a co-op has written a message, so on every co-op
   * that has not this is one query returning nothing. The 15-minute cadence
   * means a briefing set for 07:00 arrives between 07:00 and 07:15 — worth
   * saying out loud, because "at 7am" is what the admin screen promises.
   */
  private async sendHostBriefings(now: Date): Promise<TaskResult> {
    try {
      const { sent, failed, errors } = await this.hosting.sendDue(now);
      if (sent > 0) this.logger.log(`Sent ${sent} host briefing email(s)`);
      return { task: 'send-host-briefings', processed: sent, failed, errors };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error('Failed to send host briefings', error as Error);
      return { task: 'send-host-briefings', processed: 0, failed: 1, errors: [message] };
    }
  }

  /**
   * Move buddy pairings along (BEL-01, PRD §7).
   *
   * The PRD asks for at least hourly; this runs every fifteen minutes, which
   * mostly matters at the edges of the 48-hour timeout — a member who is
   * released from an ask an hour late has spent an extra hour thinking they
   * still owe somebody something.
   *
   * The work itself is idempotent, so this task's only job is to call it and
   * to not let its failure strand the tasks after it.
   */
  private async advanceBuddyPairings(now: Date): Promise<TaskResult> {
    const result: TaskResult = { task: 'advance-buddy-pairings', processed: 0, failed: 0, errors: [] };

    const { expired, offTheHookSent, advanced } = await this.buddies.runDueWork(now);
    result.processed = expired + offTheHookSent + advanced;

    if (result.processed > 0) {
      this.logger.log(
        `Buddy sweep: ${expired} expired, ${offTheHookSent} released, ${advanced} moved on`,
      );
    }

    return result;
  }

  /**
   * Write the prose for reports waiting on it (IMP-23 phase 2).
   *
   * The safety net, and — until a background function is triggerable — the
   * only runner. A composition takes far longer than a synchronous function
   * may run, so it cannot happen in the request that asks for it; here there
   * are fifteen minutes and nobody waiting on a socket.
   *
   * **Stuck reports are reclaimed first.** A `COMPOSING` row whose runner
   * died would otherwise sit there forever, because the claim that protects
   * against two composers writing the same blocks is also what stops a third
   * from ever picking it up.
   *
   * Capped per run and the overflow is logged rather than silently dropped: a
   * quiet cap reads as "everything was done" when it was not.
   */
  private async composePendingReports(now: Date): Promise<TaskResult> {
    const result: TaskResult = { task: 'compose-pending-reports', processed: 0, failed: 0, errors: [] };

    const STUCK_AFTER_MS = 10 * 60 * 1000;
    const PER_RUN = 3;

    const reclaimed = await this.prisma.impactReport.updateMany({
      where: {
        composeStatus: 'COMPOSING',
        updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
      },
      data: { composeStatus: 'PENDING' },
    });
    if (reclaimed.count > 0) {
      this.logger.warn(`Reclaimed ${reclaimed.count} report(s) stuck mid-composition`);
    }

    const waiting = await this.prisma.impactReport.findMany({
      where: { tier: 'WRITTEN', composeStatus: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, orgId: true },
      take: PER_RUN + 1,
    });

    if (waiting.length > PER_RUN) {
      this.logger.log(
        `${waiting.length - PER_RUN}+ report(s) left for the next run — this run is capped at ${PER_RUN}`,
      );
    }

    for (const report of waiting.slice(0, PER_RUN)) {
      try {
        const outcome = await this.reports.compose(report.orgId, report.id);
        if (outcome.status === 'failed') {
          // Recorded on the report and shown to the admin, so this is a
          // count rather than an error: nothing is stuck and nothing is lost.
          result.failed += 1;
          result.errors.push(`${report.id}: ${outcome.note}`);
        } else {
          result.processed += 1;
        }
      } catch (error) {
        result.failed += 1;
        result.errors.push(`${report.id}: ${(error as Error).message}`);
      }
    }

    return result;
  }

  /**
   * Release room slots held for a payment that never arrived (SPC-06).
   *
   * A paid room takes a `PENDING_PAYMENT` hold before sending the member to
   * Stripe, because a room hour is exclusive and cannot be sold twice and
   * reconciled afterwards. Most abandoned checkouts are simply people closing
   * the tab, and without this the slot they never paid for would block that
   * room forever.
   *
   * `checkConflicts` already ignores an expired hold, so a room is bookable
   * again the moment the hold lapses rather than whenever this next runs —
   * this only tidies the rows up. That ordering matters: if the sweep were
   * what freed the slot, a member could be told a room was taken for up to
   * fifteen minutes after it was not.
   *
   * Filters on `paidAt: null` as well as the status, so a webhook that lands
   * in the same moment cannot have its confirmed booking cancelled underneath
   * it.
   */
  private async releaseExpiredHolds(now: Date): Promise<TaskResult> {
    try {
      const { count } = await this.prisma.booking.updateMany({
        where: {
          status: 'PENDING_PAYMENT',
          paidAt: null,
          holdExpiresAt: { lt: now },
        },
        data: { status: 'CANCELED', canceledAt: now, holdExpiresAt: null },
      });

      if (count > 0) {
        this.logger.log(`Released ${count} expired booking hold(s)`);
      }
      return { task: 'release-expired-booking-holds', processed: count, failed: 0, errors: [] };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error('Failed to release expired booking holds', error as Error);
      return {
        task: 'release-expired-booking-holds',
        processed: 0,
        failed: 1,
        errors: [message],
      };
    }
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
    // Selects across every org — this is system-level work, not a request —
    // and reads each proposal's own org so it can be passed back into the
    // org-scoped service method (CMN-07). The scheduler is the one caller
    // entitled to cross org boundaries, and it still names the org it is
    // acting in rather than being handed an unscoped back door.
    const due = await this.prisma.proposal.findMany({
      where: { status: 'OPEN', closesAt: { not: null, lte: now } },
      select: { id: true, channel: { select: { orgId: true } } },
    });

    const result: TaskResult = {
      task: 'close-due-proposals',
      processed: 0,
      failed: 0,
      errors: [],
    };

    for (const { id, channel } of due) {
      try {
        await this.commons.closeProposal(channel.orgId, id);
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
