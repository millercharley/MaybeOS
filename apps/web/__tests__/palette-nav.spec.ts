import { paletteHref, resolveOrgSlug, type Membership } from '@/lib/palette-nav';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Where a search result goes (UI-04).
 *
 * Charley suspended a duplicate co-op from the MaybeOS console, searched for
 * the member who had made it, and was told he was not a member of
 * "undefined". Nothing failed: the palette read the co-op out of the address
 * and cast it to a string, the address had no co-op in it, and the router
 * went exactly where it was told.
 */
const orgs: Membership[] = [
  { orgId: 'org-1', org: { slug: 'maybeitsfate' } },
  { orgId: 'org-2', org: { slug: 'gltc' } },
];

describe('which co-op a search acts on', () => {
  it('uses the address when there is one', () => {
    expect(resolveOrgSlug('gltc', orgs, 'org-1')).toBe('gltc');
  });

  /** The case that produced the bug: /platform has no co-op in the address. */
  it('falls back to the co-op they have open', () => {
    expect(resolveOrgSlug(undefined, orgs, 'org-2')).toBe('gltc');
  });

  it('falls back to their only co-op when none is open', () => {
    expect(resolveOrgSlug(undefined, [orgs[0]], null)).toBe('maybeitsfate');
  });

  it('answers null rather than guessing when they are in none', () => {
    // A platform admin with no membership of their own can reach this.
    expect(resolveOrgSlug(undefined, [], null)).toBeNull();
    expect(resolveOrgSlug(undefined, undefined, null)).toBeNull();
  });

  it('answers null when the co-op it finds has no slug', () => {
    expect(resolveOrgSlug(undefined, [{ orgId: 'org-1', org: null }], 'org-1')).toBeNull();
  });
});

describe('the address a result goes to', () => {
  it.each([
    ['channel', '/admin/maybeitsfate/commons?channel=c1'],
    ['page', '/admin/maybeitsfate/commons?page=c1'],
    ['event', '/admin/maybeitsfate/events'],
    ['member', '/admin/maybeitsfate/members'],
  ] as const)('sends a %s to the right page', (kind, expected) => {
    expect(paletteHref(kind, 'c1', 'maybeitsfate')).toBe(expected);
  });

  /**
   * The whole point. A path built from nothing is still a path, and the
   * router will go to it — then the page blames the person for a link the
   * product wrote.
   */
  it.each(['channel', 'page', 'event', 'member'] as const)(
    'refuses to build a %s link with no co-op',
    (kind) => {
      expect(paletteHref(kind, 'c1', null)).toBeNull();
    },
  );

  it('never produces a path containing "undefined"', () => {
    for (const kind of ['channel', 'page', 'event', 'member'] as const) {
      expect(paletteHref(kind, 'c1', null) ?? '').not.toContain('undefined');
      expect(paletteHref(kind, 'c1', 'maybeitsfate')).not.toContain('undefined');
    }
  });

  it('escapes an id rather than letting it add query parameters', () => {
    expect(paletteHref('channel', 'a&b=c', 'maybeitsfate')).toBe(
      '/admin/maybeitsfate/commons?channel=a%26b%3Dc',
    );
  });
});

describe('the palette itself', () => {
  const code = readFileSync(
    join(process.cwd(), 'components/layout/command-palette.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('no longer casts the route param to a string', () => {
    // `as string` on a value that is genuinely undefined is what silenced
    // TypeScript here for as long as this bug existed.
    expect(code).not.toMatch(/orgSlug as string/);
  });

  it('builds its links through the helper', () => {
    expect(code).toContain('paletteHref(result.kind, result.id, orgSlug)');
    expect(code).not.toMatch(/router\.push\(`\/admin\/\$\{orgSlug\}/);
  });

  it('keeps the co-op in the callback’s dependencies', () => {
    // It was `[router]` alone, so the callback held whichever co-op was open
    // when it was first created.
    expect(code.replace(/\s+/g, '')).toContain('[router,orgSlug]');
  });
});
