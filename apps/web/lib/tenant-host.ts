/**
 * Which co-op a hostname addresses (SCL-01).
 *
 * Kept out of `middleware.ts` on purpose: that module imports `next/server`,
 * which needs the edge runtime's globals, so anything living beside it can
 * only be tested by standing up that runtime. This decides what every request
 * renders and it is pure string handling — it should be testable on its own.
 *
 * The previous rule was "the hostname has three or more labels", which is true
 * of a great many hostnames that are not a co-op:
 *
 *   - `maybeos-web-prod.netlify.app` — the site's own Netlify hostname. Every
 *     public page rewrote to a portal for an org called "maybeos-web-prod",
 *     so the marketing site and every public org page 404'd there while the
 *     custom domain worked. Deploy previews had the same problem, which is
 *     the worst place for it: previews exist to be checked before release.
 *   - `deploy-preview-12--maybeos-web-prod.netlify.app` — same.
 *   - `127.0.0.1:3000` — four labels, so "127" became an org slug.
 *
 * Anchoring to a known root domain is the fix. Anything that is not a
 * subdomain of one of them is served as the app itself, which is the safe
 * direction to fail — an unrecognised host shows the product rather than a
 * portal for an org that does not exist.
 */
const ROOT_DOMAINS = (process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAINS || 'maybeos.org')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

/** Subdomains the platform uses itself, so no co-op can claim them. */
const RESERVED = new Set(['app', 'api', 'www', 'admin', 'staging', 'preview']);

export function tenantFromHost(host: string): string | null {
  // Strip the port; `sunrise.maybeos.org:3000` is still sunrise.
  const hostname = host.split(':')[0].toLowerCase();
  if (!hostname) return null;

  for (const root of ROOT_DOMAINS) {
    if (!hostname.endsWith('.' + root)) continue;

    const label = hostname.slice(0, -(root.length + 1));
    // Only a single label is a tenant. `a.b.maybeos.org` is not a co-op
    // called "a.b", and treating it as one would invent an org from a
    // hostname somebody made up.
    if (!label || label.includes('.')) return null;
    if (RESERVED.has(label)) return null;

    return label;
  }

  return null;
}
