import * as Sentry from '@sentry/nextjs';
import { sharedOptions } from './sentry.shared';

/**
 * Node runtime (SSR, server components, route handlers).
 *
 * This is a server-side secret path, so it reads the non-public SENTRY_DSN
 * first and falls back to the public one — a single DSN configured for the
 * browser should cover the server too rather than silently leaving it dark.
 */
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    ...sharedOptions,
    dsn,
    maxBreadcrumbs: 30,
  });
}
