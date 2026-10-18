import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every email MaybeOS might send, in one card (UI-03).
 *
 * These arrived one at a time and each got a card of its own — sensible each
 * time, and four nearly identical boxes by the end of it. Charley:
 * "consolidate the member email preferences into one card."
 *
 * The properties worth keeping are the ones each separate card had, which a
 * consolidation is the easiest possible place to drop: reading the real
 * setting rather than the schema default, taking the saved value back from
 * the server, and keeping the rows independent.
 */
const card = readFileSync(join(process.cwd(), 'components/member/email-preferences.tsx'), 'utf8');
const settings = readFileSync(
  join(process.cwd(), 'app/(app)/(dashboard)/member/[orgSlug]/settings/page.tsx'),
  'utf8',
);
const profile = readFileSync(
  join(process.cwd(), 'app/(app)/(dashboard)/member/[orgSlug]/profile/page.tsx'),
  'utf8',
);

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const flat = (source: string) => code(source).replace(/\s+/g, '');

describe('the one email card', () => {
  it('is on My Settings', () => {
    expect(code(settings)).toContain('<EmailPreferences />');
  });

  it('is not also on My Profile', () => {
    // The split is by audience: nothing on My Profile that only this member
    // ever sees.
    expect(code(profile)).not.toContain('EmailPreferences');
  });

  it.each([
    ['messages', 'api.commons.messageEmails'],
    ['announcements', 'api.commons.announcementEmails'],
    ['the Commons digest', 'api.commons.digestEmails'],
    ['Radar', 'api.radar.myInterests'],
    ['the monthly recap', 'api.recap.emails'],
  ])('reads the real setting for %s', (_name, call) => {
    expect(flat(card)).toContain(call.replace(/\s+/g, ''));
  });

  it.each([
    ['messages', 'api.commons.setMessageEmails'],
    ['announcements', 'api.commons.setAnnouncementEmails'],
    ['the Commons digest', 'api.commons.setDigestEmails'],
    ['Radar', 'api.radar.setEmails'],
    ['the monthly recap', 'api.recap.setEmails'],
  ])('saves %s through the API', (_name, call) => {
    expect(flat(card)).toContain(call.replace(/\s+/g, ''));
  });

  /**
   * One failing setting must not cost a member the other four. The monthly
   * recap belongs to a plan a co-op may not be on, and its endpoint answers
   * accordingly — a single `await` chain would blank the whole card.
   */
  it('asks for all of them at once and lets each fail alone', () => {
    expect(flat(card)).toContain('Promise.allSettled');
  });

  it('hides a row the co-op’s plan does not include, rather than erroring', () => {
    expect(flat(card)).toContain('r.available&&r.on!==null');
  });

  it('draws no row before its real value is known', () => {
    // A box that renders ticked and then flips is the same lie, told faster.
    expect(code(card)).toMatch(/on: boolean \| null/);
  });

  it('takes the saved value back from the server, not the clicked one', () => {
    expect(flat(card)).toContain('r.key===key?{...r,on:saved}');
  });

  it('keeps the rows independent', () => {
    // One switch for "email me" would make the common choice — tell me when
    // somebody writes, spare me the weekly summary — impossible to express.
    expect(flat(card)).toContain('set(row.key,e.target.checked)');
  });

  it('says that turning one off leaves the others alone', () => {
    expect(code(card)).toMatch(/leaves the others alone/i);
  });
});
