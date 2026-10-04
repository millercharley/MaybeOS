import { readFileSync } from 'fs';
import { join } from 'path';
import { sidebarSections } from '@/lib/nav';

/**
 * The admin's Commons reads the same way round as the member's (CMN-15).
 *
 * Charley: "The Admin's version of the Commons should have the same vertical
 * orientation of the member's version of the Commons, with the message
 * composer on the bottom and the latest message on the bottom with older
 * messages running vertically to the top."
 *
 * It ran the other way — composer at the top, newest post beneath it, older
 * ones below that — so the same conversation ran in opposite directions
 * depending on which door an organiser came through.
 *
 * Scanned rather than rendered: the facts here are an order in the markup and
 * a `.reverse()`, both of which a test can read directly, and the page needs
 * an admin session to draw at all.
 */
const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

const admin = read('app/(app)/(dashboard)/admin/[orgSlug]/commons/page.tsx');
const member = read('app/(app)/portal/[orgSlug]/commons/page.tsx');

describe('the admin Commons, as a column', () => {
  it('puts the composer after the messages, not before them', () => {
    const scroller = admin.indexOf('ref={scroller}');
    const composer = admin.indexOf('submitLabel="Post"');

    expect(scroller).toBeGreaterThan(-1);
    expect(composer).toBeGreaterThan(scroller);
  });

  it('shows the oldest message first, so the newest sits by the composer', () => {
    // The API answers newest-first, which is right for a page that lists and
    // backwards for one that reads as a conversation.
    expect(admin).toContain('const stream = [...posts].reverse()');
    expect(admin).toContain('{stream.map(');
  });

  it('opens at the end of the conversation', () => {
    // Having flipped the order, a pane scrolled to the top would show the
    // oldest message in the page — the worst of both arrangements.
    expect(admin).toContain("scrollIntoView({ block: 'end' })");
  });

  it('scrolls the messages rather than the page, like the member view', () => {
    for (const page of [admin, member]) {
      expect(page).toContain('min-h-0 flex-1');
      expect(page).toContain('overflow-y-auto');
    }
  });
});

describe('Proposals, in the Administration nav', () => {
  const sections = sidebarSections({
    membership: { role: 'ADMIN', org: { name: 'MaybeItsFate', slug: 'maybeitsfate' } },
    signedIn: true,
  });
  const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));

  it('has a tab of its own', () => {
    expect(hrefs).toContain('/admin/maybeitsfate/proposals');
  });

  it('sits next to the Commons it came out of', () => {
    const commons = hrefs.indexOf('/admin/maybeitsfate/commons');
    expect(hrefs[commons + 1]).toBe('/admin/maybeitsfate/proposals');
  });

  it('is gone from the Commons page', () => {
    // Left behind, it would now sit below a scrolling column — off the
    // bottom of the screen, under however many messages the channel holds.
    expect(admin).not.toContain('Active Proposals');
    expect(admin).not.toContain('listProposals');
  });

  it('is not offered to a member — only organisers count votes here', () => {
    const asMember = sidebarSections({
      membership: { role: 'MEMBER', org: { name: 'MaybeItsFate', slug: 'maybeitsfate' } },
      signedIn: true,
    }).flatMap((s) => s.items.map((i) => i.href));

    expect(asMember).not.toContain('/admin/maybeitsfate/proposals');
  });
});
