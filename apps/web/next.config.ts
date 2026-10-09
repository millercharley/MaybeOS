import type { NextConfig } from 'next';
import path from 'path';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@maybeos/shared'],
  /**
   * Leave the sanitiser's dependencies out of the server bundle (OPS-09).
   *
   * `isomorphic-dompurify` loads jsdom when it runs in Node, and jsdom reads
   * its own `browser/default-stylesheet.css` off disk at startup. Bundling it
   * brings the JavaScript along and leaves that file behind, so every server
   * render of a page containing rich text threw
   * `ENOENT: … /browser/default-stylesheet.css` — 1,988 of them in Sentry over
   * five weeks, and 93% of all errors the product reported.
   *
   * Nobody saw it: the pages that sanitise are all `use client`, so the work
   * that matters happens in the browser against a real DOM, and the throw only
   * cost the discarded server pass. It fails closed — `sanitizeWikiHtml` raises
   * rather than returning unsanitised HTML — so it was never an XSS hole.
   *
   * Marking it external makes Next require it from `node_modules` at runtime
   * and hand it to file tracing, which carries the whole package, assets
   * included.
   */
  serverExternalPackages: ['isomorphic-dompurify'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  /**
   * The portal home is My Dashboard (NAV-04).
   *
   * The page itself also calls `redirect()`, and that works — but a
   * `redirect()` in a page nested under a client layout comes back as a 200
   * carrying a client-side navigation, so the shell paints and then leaves.
   * Declaring it here makes it a real 307 at the edge, before React.
   *
   * Temporary, not permanent: a 308 is cached by the browser indefinitely, and
   * an address we might want back should not be un-takeable. The page-level
   * redirect stays as the backstop for any path that reaches it another way.
   */
  async redirects() {
    return [
      { source: '/portal/:orgSlug', destination: '/member/:orgSlug', permanent: false },
    ];
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
