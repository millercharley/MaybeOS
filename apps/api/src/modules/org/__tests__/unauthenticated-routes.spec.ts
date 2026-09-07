import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The list of routes that answer without a session (SEC-13).
 *
 * Three leaks in three days — `MEM-14` (tier price ids), `SEC-11`
 * (`by-slug` returning the whole org row), `SEC-12` (a room's Google tokens on
 * a public event) — all the same shape: an endpoint written when the model was
 * smaller, returning a row that later grew a sensitive column.
 *
 * A sweep found them. This keeps the sweep from being a one-off: the set of
 * unauthenticated routes is written down, and adding one has to be a decision
 * somebody makes on purpose rather than a guard nobody noticed was missing.
 *
 * Deliberately a list of *routes*, not of fields. What each one returns is
 * pinned by its own test — `public-tier-fields`, `public-org-fields`,
 * `public-event-fields`. This is the index.
 */
const EXPECTED = [
  // Signing in, and the flows that have no session by definition. `login`
  // and `refresh` are absent because they do carry guards — `LocalAuthGuard`
  // and `JwtAuthGuard` — which is what this scan looks for.
  'POST /auth/register',
  'POST /auth/magic-link',
  'GET /auth/magic-link/verify',

  // Redirect targets: a browser arrives with no Authorization header. Both
  // carry an HMAC-signed `state` (PAY-05, SEC-14).
  'GET /calendar/oauth/callback',
  'GET /connect/oauth/callback',
  // Stripe signs its webhooks; the signature is the authentication.
  'POST /stripe/webhooks',

  // A token in the URL is the authorisation: 32 random bytes, single use.
  'GET /buddy/:token',
  'GET /invites',

  // What a co-op has chosen to publish.
  'GET /orgs/by-slug/:slug',
  'GET /orgs/:orgId/tiers',
  'GET /orgs/:orgId/events/public',
  'GET /orgs/:orgId/events/feed.json',
  'GET /orgs/:orgId/events/feed.ics',
  'GET /public/events/:orgSlug/:eventSlug',
  'GET /public/events/:orgSlug/:eventSlug/attachments',
  'GET /public/reports/:orgSlug/:reportSlug',
  'GET /embed/:orgSlug/events',
  'GET /embed/:orgSlug/membership',

  // Joining and buying, for somebody who is not a member yet.
  'POST /orgs/:orgId/events/:eventId/rsvp/guest',
  'POST /orgs/:orgId/events/:eventId/tickets/checkout',

  // Liveness.
  'GET /health',
];

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return controllers(full);
    return full.endsWith('.controller.ts') ? [full] : [];
  });
}

/**
 * Comments are stripped first, then decorators are read as one run.
 *
 * Both halves were learned the hard way while writing this. A regex over the
 * raw source skips any method whose decorators are separated by a comment —
 * several are — and a line-based reader that ends the run at the first
 * non-`@` line breaks on a multi-line decorator argument, which made three
 * guarded routes look open. Either mistake makes this index quietly wrong,
 * which is the failure it exists to prevent.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function unguardedRoutes(): string[] {
  const found: string[] = [];
  for (const file of controllers(join(__dirname, '..', '..'))) {
    const src = withoutComments(readFileSync(file, 'utf8'));
    const classDecorators = /((?:@[\w.]+\((?:[^()]|\([^()]*\))*\)\s*)*)export class/s.exec(src);
    const classGuarded = classDecorators ? classDecorators[1].includes('UseGuards') : false;
    const controller = /@Controller\('?([^')]*)'?\)/.exec(src);
    const prefix = (controller?.[1] ?? '').replace(/'/g, '');

    const methods =
      /((?:[ \t]*@[\w.]+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)[ \t]*\n\s*)+)(?:async[ \t]+)?[A-Za-z_]\w*\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = methods.exec(src))) {
      const block = match[1];
      const http = /@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/.exec(block);
      if (!http) continue;
      if (block.includes('UseGuards') || classGuarded) continue;
      const path = http[2].trim().replace(/'/g, '');
      found.push(`${http[1].toUpperCase()} /${[prefix, path].filter(Boolean).join('/')}`);
    }
  }
  return found.sort();
}

describe('routes that answer without a session', () => {
  it('is exactly this list', () => {
    // If this fails on a route you added: decide whether it should be public,
    // then either add a guard or add it here *with* a test pinning what it
    // returns. The failure is the point — an unguarded route should never be
    // able to arrive quietly.
    expect(unguardedRoutes()).toEqual([...EXPECTED].sort());
  });

  it('does not include the org row endpoint', () => {
    // `GET /orgs/:orgId` returns every column, including the co-op's Stripe
    // customer and subscription ids. It was unauthenticated until SEC-13, and
    // confirmed leaking on production before the guard went on.
    expect(unguardedRoutes()).not.toContain('GET /orgs/:orgId');
  });
});
