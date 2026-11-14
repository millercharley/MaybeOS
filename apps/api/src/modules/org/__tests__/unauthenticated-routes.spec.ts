import { stripComments } from '../../../common/testing/source-scan';
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
  // carry an HMAC-signed `state` (PAY-05, SEC-14, SOC-01).
  'GET /calendar/oauth/callback',
  'GET /connect/oauth/callback',
  // Facebook Login for sharing events (SOC-01), with the same signed state,
  // marked `flow: 'meta'` so another flow's state is refused.
  'GET /social/meta/callback',
  // Stripe signs its webhooks; the signature is the authentication.
  'POST /stripe/webhooks',

  // A token in the URL is the authorisation: 32 random bytes, single use.
  'GET /buddy/:token',
  // Stopping Radar email from the link in one (RDR-01). HMAC-signed, and it
  // authorises exactly one thing: switching that membership's digest off.
  'POST /radar/unsubscribe',
  // A ticket buyer's door pass (EVT-46). HMAC-signed over the event and the
  // address that paid, and it authorises exactly one thing: seeing how many
  // seats that address holds. The people it serves are not members and have
  // no account, so there is no session to ask for.
  'GET /tickets/pass',
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
  /*
    The same public events as an email-safe RSS feed (EVT-55). Public for
    the same reason the website embed is — a campaign tool fetches it with
    no session and no way to hold one — and it carries exactly what that
    embed carries, which is `listPublicEvents` without the member flag.
    Members-only events are not in it, and neither are faces or attendance.
  */
  'GET /embed/:orgSlug/rss',
  // The same public events as one laid-out HTML block (EVT-60), for pasting
  // into a campaign tool that rewrites what a feed hands it. Same data, same
  // reason it is public: it is fetched with no session.
  'GET /embed/:orgSlug/email.html',

  // Joining and buying, for somebody who is not a member yet.
  'POST /orgs/:orgId/events/:eventId/rsvp/guest',
  'POST /orgs/:orgId/events/:eventId/tickets/checkout',

  // MaybeOS's own prices for the landing page (WEB-02). Nothing about any co-op.
  'GET /pricing',

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
  return stripComments(src);
}

interface ControllerClass {
  /** This class's own decorator run — where its guard and prefix live. */
  decorators: string;
  /** Its own body, ending where the next class's decorators begin. */
  body: string;
}

/**
 * Every controller class in a file, each with its own decorators and body.
 *
 * **A file is not one class, and reading it as one hid routes.** Both lookups
 * here used to be non-global `exec` calls over the whole file, so the guard
 * and the `@Controller` prefix were taken from the *first* class and applied
 * to every route in the file. Because a guarded class makes the method loop
 * `continue`, a guarded first class silently excluded every route in a second
 * class from the audit — not mislabelled, absent. `unguardedRoutes()` would
 * not list them, `toEqual(EXPECTED)` would pass, and a public route added to
 * a second class would never be mentioned by the one test whose whole job is
 * to mention it.
 *
 * It failed in the dangerous direction. Guarded first, unguarded second is
 * silent; the reverse is a false positive, which is noisy and safe.
 *
 * `social.controller.ts` already has exactly this shape —
 * `SocialAdminController` and `EventShareController` — and both happen to
 * carry class-level guards, so nothing was ever exposed. That is luck, not
 * design: two routes sat outside the audit's view, and the day one of them
 * lost its guard this file would have said nothing. The test below removes
 * that guard from the real source to prove it now speaks up.
 */
function classesIn(src: string): ControllerClass[] {
  // Global, so every class is found rather than only the first.
  const pattern = /((?:@[\w.]+\((?:[^()]|\([^()]*\))*\)\s*)*)export class/gs;

  const heads: Array<{ at: number; decorators: string; after: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src))) {
    heads.push({
      at: match.index,
      decorators: match[1],
      after: match.index + match[0].length,
    });
  }

  return heads.map((head, i) => ({
    decorators: head.decorators,
    // Up to the next class's decorators, not its `export class`, or the
    // neighbour's `@Controller` would land in this class's body.
    body: src.slice(head.after, heads[i + 1]?.at ?? src.length),
  }));
}

/**
 * The unguarded routes in one controller file's source.
 *
 * Takes source rather than a path so the parser can be tested directly. The
 * bug above survived because nothing exercised this logic on a shape it got
 * wrong; a function that only reads the filesystem can only be checked
 * against whatever the filesystem happens to contain today.
 */
export function routesIn(source: string): string[] {
  const src = withoutComments(source);
  const found: string[] = [];

  for (const klass of classesIn(src)) {
    const classGuarded = klass.decorators.includes('UseGuards');
    const controller = /@Controller\('?([^')]*)'?\)/.exec(klass.decorators);
    const prefix = (controller?.[1] ?? '').replace(/'/g, '');

    const methods =
      /((?:[ \t]*@[\w.]+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)[ \t]*\n\s*)+)(?:async[ \t]+)?[A-Za-z_]\w*\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = methods.exec(klass.body))) {
      const block = match[1];
      const http = /@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/.exec(block);
      if (!http) continue;
      if (block.includes('UseGuards') || classGuarded) continue;
      const path = http[2].trim().replace(/'/g, '');
      found.push(`${http[1].toUpperCase()} /${[prefix, path].filter(Boolean).join('/')}`);
    }
  }

  return found;
}

function unguardedRoutes(): string[] {
  return controllers(join(__dirname, '..', '..'))
    .flatMap((file) => routesIn(readFileSync(file, 'utf8')))
    .sort();
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

/**
 * The hole the index had until 2026-11-13.
 *
 * A guard that cannot see part of the codebase reports clean on the thing it
 * was built to catch, which is worse than having no guard: the empty list
 * reads as an assurance. These exercise the parser on the shape it got wrong
 * rather than on whatever happens to be on disk.
 */
describe('a file holding more than one controller class', () => {
  const GUARDED_FIRST = `
@Controller('orgs/:orgId/admin')
@UseGuards(JwtAuthGuard, OrgMembershipGuard)
export class AdminThing {
  @Get()
  read() {}
}

@Controller('public/thing')
export class PublicThing {
  @Get(':id')
  open() {}
}
`;

  it('finds an unguarded route in the second class', () => {
    // The whole bug in one assertion: this used to be [].
    expect(routesIn(GUARDED_FIRST)).toEqual(['GET /public/thing/:id']);
  });

  it('does not file it under the first class’s prefix', () => {
    expect(routesIn(GUARDED_FIRST)).not.toContain('GET /orgs/:orgId/admin/:id');
  });

  it('still keeps a guarded class quiet', () => {
    expect(routesIn(GUARDED_FIRST)).not.toContain('GET /orgs/:orgId/admin');
  });

  /** The reverse order was never broken, and must not become so. */
  it('reads an unguarded first class and a guarded second', () => {
    const unguardedFirst = `
@Controller('public/thing')
export class PublicThing {
  @Get(':id')
  open() {}
}

@Controller('orgs/:orgId/admin')
@UseGuards(JwtAuthGuard)
export class AdminThing {
  @Get()
  read() {}
}
`;
    expect(routesIn(unguardedFirst)).toEqual(['GET /public/thing/:id']);
  });

  /**
   * And the same thing proved against the real file that has this shape.
   *
   * `social.controller.ts` answers with an empty list either way, because both
   * its classes are guarded — so an assertion on the file as it stands cannot
   * tell a parser that looked from one that stopped early. Removing the second
   * class's guard from the source is what distinguishes them: before this fix
   * the answer stayed empty, which is precisely the silence worth preventing.
   */
  it('would speak up if the second class in social.controller.ts lost its guard', () => {
    const file = join(__dirname, '..', '..', 'social', 'social.controller.ts');
    const src = readFileSync(file, 'utf8');

    expect(routesIn(src)).toEqual([]);

    const exposed = src.replace(
      "@Controller('orgs/:orgId/events/:eventId/social')\n@UseGuards(JwtAuthGuard, OrgMembershipGuard)",
      "@Controller('orgs/:orgId/events/:eventId/social')",
    );
    // If the decorators are ever reformatted this replace stops matching, and
    // the test would otherwise pass by asserting nothing.
    expect(exposed).not.toBe(src);

    expect(routesIn(exposed)).toEqual([
      'GET /orgs/:orgId/events/:eventId/social',
      'POST /orgs/:orgId/events/:eventId/social',
    ]);
  });
});
