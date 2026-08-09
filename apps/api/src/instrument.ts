import * as Sentry from '@sentry/nestjs';

/**
 * Sentry initialization, deliberately isolated in its own module.
 *
 * This MUST be the first import in every entry point (main.ts, lambda.ts).
 * Sentry v8 instruments via OpenTelemetry, which works by monkey-patching
 * modules (http, pg, express) as they are required — so it has to run before
 * anything else is imported. Initializing later, as this previously did from
 * inside the Nest bootstrap, leaves that instrumentation unattached: errors
 * captured explicitly still send, but automatic HTTP/DB spans and much of the
 * request context never materialize.
 *
 * No DSN means no-op: Sentry.init is simply not called, so local development
 * and CI stay silent without needing a separate code path.
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',

    // 10% of transactions in production. Traces are the expensive part of the
    // quota, and this is a small co-op deployment, not a service that needs
    // statistically dense sampling.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // The API runs as a Netlify Function: one invocation handles one request
    // and the process is frozen immediately afterward. Keep the send path as
    // short as possible so the flush in lambda.ts has little left to do.
    maxBreadcrumbs: 30,

    beforeSend(event) {
      // Belt-and-braces scrub. Sentry masks common credential keys already,
      // but the Authorization header and the Supabase connection string would
      // both be genuinely damaging to leak into a third-party dashboard.
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['Authorization'];
        delete event.request.headers['cookie'];
      }
      if (event.extra?.['DATABASE_URL']) {
        delete event.extra['DATABASE_URL'];
      }
      return event;
    },
  });
}

export { Sentry };
