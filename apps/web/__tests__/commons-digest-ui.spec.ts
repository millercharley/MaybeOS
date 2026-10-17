import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The weekly Commons digest, where people decide about it (CMN-20).
 *
 * Two different readers and one risk each. An **organiser** who reads
 * "weekly email to members" and pictures a newsletter will either not turn it
 * on or turn it on for the wrong reason, so the card has to lead with who
 * actually receives it. A **member** who reads "weekly email" and does not
 * know it only arrives when they have been away will switch it off out of
 * caution — and they are exactly the person it exists for.
 */
const files = {
  member: 'components/member/commons-digest-emails.tsx',
  settings: 'components/settings/commons-digest.tsx',
  profile: 'app/(app)/(dashboard)/member/[orgSlug]/profile/page.tsx',
  adminSettings: 'app/(app)/(dashboard)/admin/[orgSlug]/settings/page.tsx',
};

function code(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const flat = (path: string) => code(path).replace(/\s+/g, '');

describe('where people decide about the digest', () => {
  it('the member’s switch is on their profile', () => {
    expect(code(files.profile)).toContain('<CommonsDigestEmails />');
  });

  it('the co-op’s switch is on the settings page', () => {
    expect(code(files.adminSettings)).toContain('<CommonsDigest ');
  });

  it('tells the member it only arrives when they were away', () => {
    // Without this they read "weekly email" and switch it off.
    expect(code(files.member)).toMatch(/been away|didn.{0,6}t come in/i);
  });

  it('tells the organiser it does not go to everyone', () => {
    expect(code(files.settings)).toMatch(/not to everyone|haven.{0,6}t been in/i);
  });

  it('reads the member’s real setting rather than the default', () => {
    expect(flat(files.member)).toContain('useState<boolean|null>(null)');
    expect(flat(files.member)).toContain('api.commons.digestEmails(orgId,token)');
  });

  it('takes the saved value back from the server, not the clicked one', () => {
    expect(code(files.member)).toMatch(/setOn\(saved\.commonsDigestEmails\)/);
  });

  it('is off until a co-op turns it on', () => {
    // A co-op that migrated last week must not find MaybeOS emailing its
    // roster because a deploy happened.
    expect(flat(files.settings)).toContain('org.commonsDigestEnabled??false');
  });
});
