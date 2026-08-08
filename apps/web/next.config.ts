import type { NextConfig } from 'next';
import path from 'path';

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

export default nextConfig;
