// Must be first: Sentry instruments modules as they load (see instrument.ts).
import { Sentry } from './instrument';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { SchedulerService } from './modules/scheduler/scheduler.service';
import { schedulerMonitor } from './scheduler-monitor';

/**
 * Netlify Scheduled Function entry point (D-022).
 *
 * Compiled ahead of time by `nest build` for the same reason as lambda.ts —
 * Netlify's esbuild bundler does not reliably emit the decorator metadata
 * Nest's DI depends on — so netlify/functions/scheduled-tasks.js is a thin
 * shim that requires this output.
 *
 * Three things differ deliberately from lambda.ts:
 *
 * 1. **Application context, not an HTTP server.** There is no request to
 *    serve, so no Express adapter, no global pipes, no guards. Just the DI
 *    container and the service.
 *
 * 2. **Nothing is cached between invocations, and the app is always
 *    closed.** lambda.ts keeps a warm handler because requests arrive in
 *    bursts. This runs every fifteen minutes, so a cached container would
 *    sit holding a Postgres connection for the fourteen minutes in between.
 *    D-018 exists because Prisma opens a pool per container against
 *    Supabase's 15-connection cap, and a code-only deploy once took the API
 *    down that way. A scheduler that quietly held a connection forever
 *    would be re-creating that bug on purpose. Closing the app releases it.
 *
 * 3. **It refuses non-scheduled invocations.** Netlify is documented to
 *    reject external HTTP calls to scheduled functions, but that is
 *    somebody else's promise about somebody else's edge, and the blast
 *    radius if it is ever wrong is "any stranger can close every open
 *    proposal in every co-op". Netlify posts a JSON body containing
 *    `next_run` when it fires on schedule; anything without that is turned
 *    away here as well.
 */

interface NetlifyEvent {
  body?: string | null;
  [key: string]: unknown;
}

function isScheduledInvocation(event: NetlifyEvent): boolean {
  if (!event?.body) return false;
  try {
    const parsed = JSON.parse(event.body) as { next_run?: unknown };
    return typeof parsed?.next_run === 'string';
  } catch {
    return false;
  }
}

export async function handler(
  event: NetlifyEvent,
  context: { callbackWaitsForEmptyEventLoop?: boolean },
) {
  if (context) context.callbackWaitsForEmptyEventLoop = false;

  const logger = new Logger('ScheduledTasks');

  if (!isScheduledInvocation(event)) {
    logger.warn('Rejected an invocation with no schedule payload');
    return { statusCode: 404, body: 'Not found' };
  }

  // Opened before the app is built, so a run that cannot even boot Nest is
  // still a run Sentry saw start and then saw fail — rather than a silence
  // indistinguishable from the function never being invoked (OPS-33).
  const monitor = schedulerMonitor(process.env.SENTRY_DSN ? Sentry : null);
  const checkInId = monitor.start();

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
    const result = await app.get(SchedulerService).runDueTasks();

    // Reported on their own rather than as a failed run — see reportFailures.
    monitor.reportFailures(result);
    monitor.finish(checkInId, 'ok');
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    // A throw here would be swallowed by the platform and the run would
    // look like it never happened, so report it explicitly.
    logger.error('Scheduled run failed', error as Error);
    if (process.env.SENTRY_DSN) Sentry.captureException(error);
    monitor.finish(checkInId, 'error');
    return { statusCode: 500, body: JSON.stringify({ error: (error as Error).message }) };
  } finally {
    // Order matters: close the Nest app first so Prisma disconnects and the
    // Postgres connection is handed back, then flush Sentry, then let the
    // container freeze. The check-in is in that flush — without it the
    // container freezes with the monitor's own heartbeat still buffered.
    await app?.close().catch(() => undefined);

    if (process.env.SENTRY_DSN) {
      try {
        await Sentry.flush(2000);
      } catch {
        // Never let telemetry failure surface as a run failure.
      }
    }
  }
}
