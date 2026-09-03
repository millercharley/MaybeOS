import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SCHEDULER_CRON,
  SCHEDULER_MONITOR_SLUG,
  schedulerMonitorConfig,
  schedulerMonitor,
  type MonitorSink,
} from '../scheduler-monitor';

/**
 * The Sentry cron monitor and the Netlify schedule must agree (OPS-33).
 *
 * The cadence is declared twice — Netlify needs it in `netlify.toml` to invoke
 * the function, Sentry needs it to know when a run is late — and there is no
 * mechanism making them the same. A monitor expecting a run every fifteen
 * minutes against a function that runs hourly alerts three times an hour
 * forever, which trains everybody to ignore the one alarm this exists to
 * raise.
 */
describe('the scheduler monitor', () => {
  const netlifyToml = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'netlify.toml'),
    'utf8',
  );

  it('finds the schedule netlify actually runs on', () => {
    // Guards the guard: a rename in netlify.toml must fail this test rather
    // than silently make the comparison below vacuous.
    expect(netlifyToml).toContain('[functions."scheduled-tasks"]');
  });

  it('matches the schedule Netlify invokes the function on', () => {
    const match = /\[functions\."scheduled-tasks"\][\s\S]*?schedule\s*=\s*"([^"]+)"/.exec(
      netlifyToml,
    );

    expect(match).not.toBeNull();
    expect(match![1]).toBe(SCHEDULER_CRON);
    expect(schedulerMonitorConfig.schedule.value).toBe(SCHEDULER_CRON);
  });

  it('allows a run to be late but not to overlap the next one', () => {
    // A margin longer than the interval would mean a missed run is never
    // reported, because the next one always arrives first.
    const intervalMinutes = 15;
    expect(schedulerMonitorConfig.checkinMargin).toBeLessThan(intervalMinutes);
    expect(schedulerMonitorConfig.maxRuntime).toBeLessThan(intervalMinutes);
  });

  it('reads the crontab in the zone Netlify schedules in', () => {
    // `*/15 * * * *` is the same in every zone, but an hour-of-day schedule
    // later would not be, and the timezone is easier to set now than to
    // discover the absence of then.
    expect(schedulerMonitorConfig.timezone).toBe('Etc/UTC');
  });

  it('has a stable slug', () => {
    // The slug is the monitor's identity in Sentry. Changing it silently
    // creates a second monitor and leaves the first alerting on a function
    // that no longer checks in.
    expect(SCHEDULER_MONITOR_SLUG).toBe('maybeos-scheduled-tasks');
  });
});


/**
 * The check-in itself.
 *
 * A scheduler that stops produces no errors — it produces silence, and that is
 * the failure nobody is watching for. These tests are mostly about the two
 * ways this could make things worse rather than better: alerting on the wrong
 * thing, and breaking the scheduler in order to monitor it.
 */
describe('schedulerMonitor', () => {
  const sink = () => {
    const scope = {
      setTag: jest.fn(),
      setContext: jest.fn(),
      setFingerprint: jest.fn(),
    };
    const sentry: MonitorSink & { scope: typeof scope } = {
      scope,
      captureCheckIn: jest.fn().mockReturnValue('check-in-1'),
      withScope: jest.fn((cb: (s: typeof scope) => void) => cb(scope)),
      captureMessage: jest.fn(),
    };
    return sentry;
  };

  it('opens a run and upserts the monitor in the same call', () => {
    // Upserting from code is what keeps the schedule from having to be typed
    // into the Sentry dashboard by hand and kept in step there.
    const sentry = sink();
    const id = schedulerMonitor(sentry).start();

    expect(id).toBe('check-in-1');
    expect(sentry.captureCheckIn).toHaveBeenCalledWith(
      { monitorSlug: SCHEDULER_MONITOR_SLUG, status: 'in_progress' },
      schedulerMonitorConfig,
    );
  });

  it('closes the run it opened', () => {
    const sentry = sink();
    const monitor = schedulerMonitor(sentry);
    monitor.finish(monitor.start(), 'ok');

    expect(sentry.captureCheckIn).toHaveBeenLastCalledWith({
      checkInId: 'check-in-1',
      monitorSlug: SCHEDULER_MONITOR_SLUG,
      status: 'ok',
    });
  });

  it('reports a run that threw as an error', () => {
    const sentry = sink();
    const monitor = schedulerMonitor(sentry);
    monitor.finish(monitor.start(), 'error');

    expect(sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('does nothing at all without Sentry', () => {
    // Every local run. The scheduler has to work without telemetry.
    const monitor = schedulerMonitor(null);

    expect(monitor.start()).toBeUndefined();
    expect(() => monitor.finish(undefined, 'ok')).not.toThrow();
    expect(() =>
      monitor.reportFailures({ tasks: [{ task: 't', failed: 1, errors: ['x'] }] }),
    ).not.toThrow();
  });

  it('never lets a Sentry failure become a scheduler failure', () => {
    // Monitoring must not be the reason the co-op's rota stops running.
    const sentry = sink();
    sentry.captureCheckIn = jest.fn(() => {
      throw new Error('Sentry is down');
    });
    const monitor = schedulerMonitor(sentry);

    expect(() => monitor.start()).not.toThrow();
    expect(monitor.start()).toBeUndefined();
    expect(() => monitor.finish('check-in-1', 'ok')).not.toThrow();
  });

  it('does not close a run it never opened', () => {
    const sentry = sink();
    schedulerMonitor(sentry).finish(undefined, 'ok');

    expect(sentry.captureCheckIn).not.toHaveBeenCalled();
  });

  it('keeps a failed task out of the run’s own status', () => {
    // The distinction the whole design rests on: "did the scheduler run" and
    // "did a task fail" are different questions, and conflating them makes
    // the uptime alarm flap on a transient Postmark rejection.
    const sentry = sink();
    const monitor = schedulerMonitor(sentry);
    const checkInId = monitor.start();

    monitor.reportFailures({
      tasks: [
        { task: 'send-host-briefings', failed: 2, errors: ['a', 'b'] },
        { task: 'close-due-proposals', failed: 0, errors: [] },
      ],
    });
    monitor.finish(checkInId, 'ok');

    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'Scheduled task send-host-briefings failed 2 item(s)',
      'warning',
    );
    expect(sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'ok' }),
    );
  });

  it('groups a repeatedly failing task as one issue', () => {
    // Fingerprinted per task, or a task failing every fifteen minutes is
    // ninety-six separate Sentry issues a day and nobody reads any of them.
    const sentry = sink();
    schedulerMonitor(sentry).reportFailures({
      tasks: [{ task: 'send-host-briefings', failed: 1, errors: ['x'] }],
    });

    expect(sentry.scope.setFingerprint).toHaveBeenCalledWith([
      'scheduled-task-failed',
      'send-host-briefings',
    ]);
    expect(sentry.scope.setTag).toHaveBeenCalledWith('scheduled_task', 'send-host-briefings');
  });

  it('does not ship an unbounded error list to Sentry', () => {
    const sentry = sink();
    schedulerMonitor(sentry).reportFailures({
      tasks: [{ task: 't', failed: 500, errors: Array.from({ length: 500 }, (_, i) => `e${i}`) }],
    });

    const [, context] = sentry.scope.setContext.mock.calls[0];
    expect((context as { errors: string[] }).errors).toHaveLength(10);
  });
});
