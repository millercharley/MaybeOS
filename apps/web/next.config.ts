import type { NextConfig } from 'next';
import path from 'path';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@maybeos/shared'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  async rewrites() {
    // Prefer an explicitly configured API URL. Otherwise, on Netlify
    // (where `URL` is auto-injected at build time — no dashboard config
    // needed), fall back to this site's own deployed function. Locally,
    // fall back to the dev API server. In production this rewrite is a
    // safety net: netlify.toml's own [[redirects]] for /api/* is expected
    // to intercept at the edge before Next.js ever sees the request.
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL ||
      (process.env.URL ? `${process.env.URL}/.netlify/functions/api` : 'http://localhost:3001');

    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
};

/**
 * Source maps are uploaded only when an auth token is present. Without them a
 * production stack trace is unreadable minified soup — but a missing token
 * must never fail the build. maybeos.org deploys from this config on every
 * push, and error tracking is not worth taking the site down for.
 *
 * When we can't upload them we also don't generate them: unuploaded source
 * maps would otherwise be served publicly next to the bundle, handing anyone
 * the full unminified source.
 */
const sentryUploadVars = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'] as const;
const missingUploadVars = sentryUploadVars.filter((v) => !process.env[v]);
const canUploadSourcemaps = missingUploadVars.length === 0;

// Partially configuring this is the easy mistake — two of three variables set
// looks done and silently uploads nothing. Say so loudly in the build log.
if (missingUploadVars.length > 0 && missingUploadVars.length < sentryUploadVars.length) {
  console.warn(
    `[sentry] Source map upload DISABLED — missing: ${missingUploadVars.join(', ')}. ` +
      `Production stack traces will stay minified until all of ${sentryUploadVars.join(', ')} are set.`,
  );
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  sourcemaps: {
    disable: !canUploadSourcemaps,
    // Don't leave the maps in the deployed output after uploading them.
    // Without this, .map files are served publicly next to the bundle and
    // anyone can reconstruct the full unminified source.
    deleteSourcemapsAfterUpload: true,
  },

  // Required here, despite the "longer build times" warning in its docs.
  // By default the plugin only uploads maps for `.next/static/chunks/app/**`
  // and `chunks/pages/**`. But `lib/api.ts` and `lib/auth-store.ts` are shared
  // across routes, so webpack emits them into the *top-level* numbered chunks
  // (107-*.js, 509-*.js, …) — which the default globs miss entirely. Those are
  // precisely the files that raise the errors we instrumented, so without this
  // the stack traces that matter most would be the ones left minified.
  widenClientFileUpload: true,

  // Surface plugin problems in the Netlify build log rather than hiding them;
  // a silent upload failure is how source maps quietly stop working.
  silent: false,

  // Tree-shake Sentry's own debug logging out of the client bundle.
  disableLogger: true,

  // This is a Netlify deploy, not Vercel.
  automaticVercelMonitors: false,
});
