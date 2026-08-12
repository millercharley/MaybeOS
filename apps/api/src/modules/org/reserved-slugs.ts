/**
 * Slugs a co-op may not take, because the platform uses them itself.
 *
 * A copy. The canonical list is `packages/shared/src/constants.ts`, which the
 * web app imports directly — the API cannot, because its tsconfig sets
 * `rootDir: ./src` and its Netlify function is bundled by esbuild, so reaching
 * outside `src/` means changing how production is built. Not worth that risk
 * for twenty strings.
 *
 * The duplication is guarded rather than trusted: `__tests__/reserved-slugs.spec.ts`
 * reads the shared file and fails if the two lists disagree.
 *
 * Why it matters: an org's slug is also its subdomain (SCL-01), so
 * `sunrise.maybeos.org` serves that co-op's portal. A co-op that registered
 * `www` or `api` would find the routing layer refusing to resolve it and its
 * portal simply unreachable — a broken account created by the product itself,
 * with no error at the moment it went wrong.
 */
export const RESERVED_ORG_SLUGS: string[] = [
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'blog',
  'cdn',
  'dashboard',
  'docs',
  'help',
  'login',
  'mail',
  'preview',
  'register',
  'staging',
  'static',
  'status',
  'support',
  'www',
];
