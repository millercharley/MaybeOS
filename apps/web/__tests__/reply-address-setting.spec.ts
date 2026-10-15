import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Where a member's reply goes (EML-03).
 *
 * Blank must mean "no replies" all the way through. The shape worth guarding
 * is the one that looks harmless: sending `''` instead of `null` on an
 * emptied field, which stores an empty string, reads back as "set", and
 * leaves the card claiming replies are on while no `Reply-To` is ever sent.
 */
const card = readFileSync(
  join(process.cwd(), 'components/settings/reply-address.tsx'),
  'utf8',
);
const page = readFileSync(
  join(process.cwd(), 'app/(app)/(dashboard)/admin/[orgSlug]/settings/page.tsx'),
  'utf8',
);

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the reply address setting', () => {
  it('is on the settings page', () => {
    expect(code(page)).toContain('<ReplyAddress');
  });

  it('clears to null rather than an empty string', () => {
    expect(code(card)).toContain('replyToEmail: value.trim() || null');
  });

  it('refetches so the card stops claiming replies are on', () => {
    expect(code(card)).toContain('onSaved()');
  });

  it('follows the server when the value changes underneath', () => {
    // Two organisers, or this component's own refetch. Seeding state once
    // from a prop and never again is the standard way this card goes stale.
    expect(code(card)).toMatch(/useEffect\(\(\) => setValue\(org\.replyToEmail \?\? ''\)/);
  });

  it('says what blank means, where somebody deciding will read it', () => {
    expect(code(card)).toMatch(/blank/i);
    expect(code(card)).toMatch(/no.reply/i);
  });

  it('does not offer to save when nothing changed', () => {
    expect(code(card)).toMatch(/disabled=\{busy \|\| !changed\}/);
  });
});
