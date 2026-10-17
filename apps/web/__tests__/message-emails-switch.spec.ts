import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The switch for message emails (CMN-19).
 *
 * The shape worth guarding is the one that looks harmless: rendering the box
 * from the schema default rather than reading the member's actual setting. A
 * member who turned these off from an email footer and then opened their
 * profile would find it ticked, which makes the unsubscribe link look broken
 * and is the fastest way to lose the rest of your email too.
 */
const card = readFileSync(join(process.cwd(), 'components/member/message-emails.tsx'), 'utf8');
const profile = readFileSync(
  join(process.cwd(), 'app/(app)/(dashboard)/member/[orgSlug]/profile/page.tsx'),
  'utf8',
);

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Formatters break a call across lines; the call is still the call. */
function flat(source: string): string {
  return code(source).replace(/\s+/g, '');
}

describe('a member can turn message emails off', () => {
  it('is on the member’s own profile', () => {
    expect(code(profile)).toContain('<MessageEmails />');
  });

  it('reads the real setting before drawing the box', () => {
    expect(flat(card)).toContain('api.commons.messageEmails(orgId,token)');
  });

  it('renders nothing until the setting is known', () => {
    /*
      Two halves, and the guard alone is not enough: seeded with `true` the
      guard is still there and never fires, and the box renders ticked for a
      member who turned these off. A box that appears ticked and then flips
      is the same lie, told faster.
    */
    expect(flat(card)).toContain('useState<boolean|null>(null)');
    expect(code(card)).toMatch(/on === null\) return null/);
  });

  it('saves through the API rather than keeping it in the page', () => {
    expect(flat(card)).toContain('api.commons.setMessageEmails(orgId,next,token)');
  });

  it('takes the saved value back from the server, not the clicked one', () => {
    // Echoing the click would show "off" even when the save failed.
    expect(code(card)).toMatch(/setOn\(saved\.messageEmails\)/);
  });

  it('tells the member the suppression rule, since it changes what they expect', () => {
    expect(code(card)).toMatch(/until you.{0,10}ve read it/i);
  });
});
