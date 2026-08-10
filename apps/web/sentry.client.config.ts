import * as Sentry from '@sentry/nextjs';
import { sharedOptions } from './sentry.shared';

/**
 * Browser-side Sentry. Loaded by the Sentry webpack plugin into the client
 * bundle before application code runs, so it catches errors thrown during
 * hydration and initial render.
 *
 * The DSN must be NEXT_PUBLIC_ — it is inlined into the bundle at build time
 * and is public by design (a DSN only permits writing events, never reading
 * them). Because it is baked in at build time, changing it requires a rebuild,
 * not just an environment-variable edit.
 *
 * No DSN means Sentry.init is never called and the SDK is inert, so local
 * development and CI stay silent without a separate code path. Same contract
 * as apps/api/src/instrument.ts.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    ...sharedOptions,
    dsn,

    // Session Replay is deliberately not enabled. It records the DOM of a
    // member-management app — names, emails, addresses, payment state — and
    // ships it to a third party. That is a decision for the co-op to make
    // knowingly, not a default to switch on for its debugging convenience.

    // Keep the trail long enough to reconstruct a user's path to the error.
    // The browser has no serverless freeze deadline, unlike the API.
    maxBreadcrumbs: 50,

    integrations: [
      // The Next.js build of this integration already understands App Router
      // navigations, so client-side route changes get their own transactions
      // without the explicit onRouterTransitionStart export that Sentry v9
      // requires. (That export does not exist in v8 — we pin v8.55.2 to match
      // @sentry/nestjs in apps/api.)
      Sentry.browserTracingIntegration(),
      // Attach the last console.error calls to each report. Cheap, and often
      // the difference between a bare stack trace and an obvious cause.
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
    ],

    // Only trace calls to our own API. Without this, every third-party
    // request would get a sentry-trace header attached, which some hosts
    // reject as an unexpected CORS header.
    tracePropagationTargets: [
      /^\//,
      /^https:\/\/([a-z0-9-]+\.)*maybeos\.org/,
      'localhost',
    ],
  });
}
