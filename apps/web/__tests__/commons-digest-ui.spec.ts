import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The weekly Commons digest, where people decide about it (CMN-20).
 *
 * The organiser's risk: somebody who reads "weekly email to members" and
 * pictures a newsletter will either not turn it on, or turn it on for the
 * wrong reason. The card has to lead with who actually receives it.
 *
 * The member's side of this moved into the one email card (UI-03) and is
 * covered by `email-preferences.spec.ts`.
 */
const files = {
  settings: 'components/settings/commons-digest.tsx',
  adminSettings: 'app/(app)/(dashboard)/admin/[orgSlug]/settings/page.tsx',
};

function code(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const flat = (path: string) => code(path).replace(/\s+/g, '');

describe('where people decide about the digest', () => {
  
  it('the co-op’s switch is on the settings page', () => {
    expect(code(files.adminSettings)).toContain('<CommonsDigest ');
  });

  
  it('tells the organiser it does not go to everyone', () => {
    expect(code(files.settings)).toMatch(/not to everyone|haven.{0,6}t been in/i);
  });

  
  
  it('is off until a co-op turns it on', () => {
    // A co-op that migrated last week must not find MaybeOS emailing its
    // roster because a deploy happened.
    expect(flat(files.settings)).toContain('org.commonsDigestEnabled??false');
  });
});
