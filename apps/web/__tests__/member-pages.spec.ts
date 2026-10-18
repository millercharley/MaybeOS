import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { movedTo, MOVED_TO_SETTINGS } from '@/lib/moved-sections';

/**
 * My Profile and My Settings (UI-03).
 *
 * My Profile had grown into two pages wearing one name: the top was how a
 * member appears to everybody else, the bottom a column of switches nobody
 * else will ever see. The split is by **audience** — if changing it changes
 * what another member sees it is on My Profile; if it changes only what
 * happens to this member it is on My Settings.
 */
const MEMBER = 'app/(app)/(dashboard)/member/[orgSlug]';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the split by audience', () => {
  const profile = code(`${MEMBER}/profile/page.tsx`);
  const settings = code(`${MEMBER}/settings/page.tsx`);

  it.each([
    ['ChangePassword', 'nobody else sees a password'],
    ['EmailPreferences', 'nobody else sees what you are sent'],
    ['DemographicProfile', 'told to the co-op in confidence'],
    ['MyInterests', 'what Radar matches on, not a public fact'],
  ])('<%s /> is on My Settings and not My Profile — %s', (component) => {
    expect(settings).toContain(`<${component} `.trimEnd());
    expect(profile).not.toContain(`<${component}`);
  });

  it('My Profile still has the thing other members look at', () => {
    expect(profile).toMatch(/instagram-handle/);
    expect(profile).toContain('How you appear to the rest of your co-op');
  });

  /** A member at a door should not have to guess which page it was on. */
  it('shows the door code on both', () => {
    expect(profile).toContain('actions={<DoorCode />}');
    expect(settings).toContain('actions={<DoorCode />}');
  });
});

describe('links made before the split', () => {
  it.each(MOVED_TO_SETTINGS)('forwards #%s to My Settings', (name) => {
    expect(movedTo(`#${name}`, 'maybeitsfate')).toBe(
      `/member/maybeitsfate/settings#${name}`,
    );
  });

  it('covers the anchors that are in emails already sent', () => {
    // Every Radar digest links to #interests; the Off the Hook notice to
    // #buddy. Those emails cannot be edited now.
    expect(MOVED_TO_SETTINGS).toEqual(expect.arrayContaining(['interests', 'buddy']));
  });

  it('leaves a hash that did not move alone', () => {
    expect(movedTo('#avatar', 'maybeitsfate')).toBeNull();
    expect(movedTo('', 'maybeitsfate')).toBeNull();
  });

  it('is safe before the slug is known', () => {
    expect(movedTo('#interests', '')).toBeNull();
  });

  it('My Profile actually forwards them', () => {
    expect(code(`${MEMBER}/profile/page.tsx`)).toContain('movedTo(window.location.hash');
  });

  it('nothing still sends members to the old anchors', () => {
    const roots = ['app', 'components', 'lib'];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir))) {
        const rel = join(dir, entry);
        if (statSync(join(process.cwd(), rel)).isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry) && /profile#(interests|buddy)/.test(read(rel))) {
          offenders.push(rel);
        }
      }
    };
    roots.forEach(walk);

    expect(offenders).toEqual([]);
  });
});

describe('what each page is called', () => {
  const nav = read('lib/nav.ts');

  it.each([
    ['My Profile', '/profile'],
    ['My Settings', '/settings'],
    ['My Dues & Billing', '/billing'],
  ])('the sidebar says %s', (label, href) => {
    expect(nav).toContain(`\${slug}${href}\`, label: '${label}'`);
  });

  it('lists My Settings directly under My Profile', () => {
    expect(nav.indexOf("label: 'My Settings'")).toBeGreaterThan(
      nav.indexOf("label: 'My Profile'"),
    );
  });

  /** Charley: "My Dues and Billing, not My dues and billing." */
  it.each([
    ['billing', 'My Dues &amp; Billing'],
    ['bookings', 'My Bookings'],
    ['service', 'My Service'],
    ['impact', 'What We&apos;re Learning'],
    ['profile', 'My Profile'],
    ['settings', 'My Settings'],
  ])('the %s page title is Title Case', (page, title) => {
    expect(read(`${MEMBER}/${page}/page.tsx`)).toContain(`title="${title}"`);
  });
});
