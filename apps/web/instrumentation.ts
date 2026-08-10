import * as Sentry from '@sentry/nextjs';

/**
 * Next.js calls register() once per runtime before any application code runs.
 * The runtime-specific configs are imported dynamically because the Node and
 * edge builds must never pull in each other's dependencies.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Reports errors thrown while rendering on the server. Next.js catches these
 * itself to render the error boundary, so without this hook they never reach
 * Sentry — the page would just fail for the user and look healthy to us.
 */
export const onRequestError = Sentry.captureRequestError;
