/**
 * The Sentry cron monitor for the scheduled function (OPS-33).
 *
 * MaybeOS has had scheduled work since D-022 and has never been able to prove
 * it runs in production. Confirming it meant reading Netlify's function logs,
 * which needs the token OPS-12 has been waiting on — so the answer has been
 * "unknown" for a month. SRV-03 raised the cost of that: a co-op switches host
 * briefings on, tells its members to expect an email, and cannot tell the
 * difference between "nobody was due" and "nothing ran".
 *
 * A check-in inverts it. The scheduler reports itself, and Sentry raises the
 * alarm when a run does not arrive — which is the failure nobody is watching
 * for, because a scheduler that stops produces no errors at all. It is
 * silence, and silence is what monitoring is for.
 *
 * The monitor is **upserted from here**, so nothing has to be configured in
 * the Sentry dashboard by hand and the schedule cannot drift between what
 * Sentry expects and what Netlify runs.
 */
export const SCHEDULER_MONITOR_SLUG = 'maybeos-scheduled-tasks';

/**
 * Must equal the schedule in `netlify.toml`.
 *
 * Declared twice because Netlify and Sentry each need their own copy, and a
 * test compares them — a monitor expecting a run every fifteen minutes
 * against a function that runs hourly would alert forever, which trains
 * everybody to ignore it.
 */
export const SCHEDULER_CRON = '*/15 * * * *';

export const schedulerMonitorConfig = {
  schedule: { type: 'crontab' as const, value: SCHEDULER_CRON },
  /**
   * Minutes late before Sentry calls a run missed. The function is invoked on
   * a fifteen-minute cadence and cold-starts a Nest context, so a couple of
   * minutes of slack is normal and five is still well short of the next run.
   */
  checkinMargin: 5,
  /**
   * Minutes before a started run is called timed out. A real run takes a few
   * seconds; five minutes means only a genuinely stuck invocation trips it.
   */
  maxRuntime: 5,
  /** The crontab above is UTC, which is what Netlify schedules in. */
  timezone: 'Etc/UTC',
};


/** The slice of the Sentry API this needs, so it can be tested without one. */
export interface MonitorSink {
  captureCheckIn(
    checkIn:
      | { monitorSlug: string; status: 'in_progress' }
      | { checkInId: string; monitorSlug: string; status: 'ok' | 'error' },
    config?: typeof schedulerMonitorConfig,
  ): string;
  withScope(callback: (scope: MonitorScope) => void): void;
  captureMessage(message: string, level: 'warning'): void;
}

export interface MonitorScope {
  setTag(key: string, value: string): void;
  setContext(key: string, value: Record<string, unknown>): void;
  setFingerprint(parts: string[]): void;
}

export interface RunSummary {
  tasks: { task: string; failed: number; errors: string[] }[];
}

/**
 * The check-in, or a no-op.
 *
 * Pass `null` when Sentry is not configured — every local run, and any
 * deployment without a DSN. Monitoring must never be the reason scheduled work
 * does not happen, so every method here swallows its own failures too: a
 * Sentry outage is not allowed to take the co-op's rota with it.
 */
export function schedulerMonitor(sentry: MonitorSink | null) {
  return {
    /** Opens a run. Returns the id to close it with, or undefined. */
    start(): string | undefined {
      if (!sentry) return undefined;
      try {
        return sentry.captureCheckIn(
          { monitorSlug: SCHEDULER_MONITOR_SLUG, status: 'in_progress' },
          schedulerMonitorConfig,
        );
      } catch {
        return undefined;
      }
    },

    /** Closes it. Silently does nothing when the run was never opened. */
    finish(checkInId: string | undefined, status: 'ok' | 'error'): void {
      if (!sentry || !checkInId) return;
      try {
        sentry.captureCheckIn({ checkInId, monitorSlug: SCHEDULER_MONITOR_SLUG, status });
      } catch {
        // As above.
      }
    },

    /**
     * Report tasks that failed, separately from whether the run happened.
     *
     * The monitor answers "is the scheduler running". Letting a transient
     * Postmark rejection mark the whole run failed would make the one alarm
     * that matters flap until nobody reads it — so task failures are their
     * own signal, fingerprinted per task so one failing every fifteen minutes
     * reads as a single ongoing issue rather than ninety-six a day.
     */
    reportFailures(result: RunSummary): void {
      if (!sentry) return;

      for (const task of result.tasks) {
        if (task.failed === 0) continue;
        try {
          sentry.withScope((scope) => {
            scope.setTag('scheduled_task', task.task);
            scope.setContext('task', { failed: task.failed, errors: task.errors.slice(0, 10) });
            scope.setFingerprint(['scheduled-task-failed', task.task]);
            sentry.captureMessage(
              `Scheduled task ${task.task} failed ${task.failed} item(s)`,
              'warning',
            );
          });
        } catch {
          // As above.
        }
      }
    },
  };
}
