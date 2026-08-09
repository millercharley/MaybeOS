// Must be first: Sentry instruments modules as they load (see instrument.ts).
import { Sentry } from './instrument';

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import serverlessHttp from 'serverless-http';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';

/**
 * Netlify Functions entry point. Netlify's bundler doesn't reliably support
 * TypeScript's decorator metadata emission that Nest's DI relies on, so
 * this file is compiled ahead of time via the normal `nest build` (tsc)
 * pipeline — the actual Netlify Function (netlify/functions/api.js) is a
 * trivial JS shim that just requires the already-compiled output below.
 *
 * The Nest app is created once per warm container and reused across
 * invocations, matching the usual serverless cold-start pattern.
 */

let cachedHandler: ReturnType<typeof serverlessHttp> | null = null;

async function bootstrapHandler() {
  const expressApp = express();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(expressApp),
    { rawBody: true, bufferLogs: true },
  );

  await configureApp(app);
  await app.init();

  return serverlessHttp(expressApp);
}

interface NetlifyEvent {
  path?: string;
  rawUrl?: string;
  [key: string]: unknown;
}

/**
 * Nest is mounted with a global 'api' prefix, so it only answers requests
 * whose path already starts with /api. Depending on Netlify's redirect
 * config and function-event format, the incoming path may or may not still
 * carry the /.netlify/functions/api prefix, and may or may not already
 * have /api on it. Normalize defensively instead of relying on assumptions
 * about Netlify's exact stripping behavior that can't be verified without
 * a live deploy.
 */
function normalizePath(event: NetlifyEvent): NetlifyEvent {
  let path = event.path || '/';
  path = path.replace(/^\/\.netlify\/functions\/api/, '') || '/';
  if (!path.startsWith('/api')) {
    path = `/api${path.startsWith('/') ? '' : '/'}${path}`;
  }
  return { ...event, path };
}

export async function handler(event: NetlifyEvent, context: { callbackWaitsForEmptyEventLoop?: boolean }) {
  context.callbackWaitsForEmptyEventLoop = false;

  if (!cachedHandler) {
    cachedHandler = await bootstrapHandler();
  }

  try {
    return await cachedHandler(normalizePath(event), context);
  } finally {
    // Critical in serverless: the runtime freezes this process the moment the
    // response is returned. Sentry queues events and sends them asynchronously,
    // so without an explicit flush anything captured during this invocation is
    // silently discarded — error tracking would look configured and report
    // nothing. Bounded so a slow or unreachable Sentry can't hold the response.
    //
    // No-ops when SENTRY_DSN is unset, since init was skipped.
    if (process.env.SENTRY_DSN) {
      try {
        await Sentry.flush(2000);
      } catch {
        // Never let telemetry failure surface as a request failure.
      }
    }
  }
}
