import * as Sentry from '@sentry/nextjs';
import { sharedOptions } from './sentry.shared';

/**
 * Edge runtime — this covers middleware.ts, which does subdomain-to-portal
 * rewriting for every request that isn't a static asset. A throw in there
 * takes down the whole site, so it is worth reporting even though it is a
 * small file.
 */
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    ...sharedOptions,
    dsn,
    maxBreadcrumbs: 20,
  });
}
