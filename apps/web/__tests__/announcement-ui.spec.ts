import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Emailing a Commons post to everybody, where it is decided (CMN-21).
 *
 * This is the one place in MaybeOS where a single click writes to four
 * hundred people and cannot be undone. The guards below are the ones that
 * make that click deliberate rather than available.
 */
const files = {
  dialog: 'components/commons/email-to-members.tsx',
  admin: 'app/(app)/(dashboard)/admin/[orgSlug]/commons/page.tsx',
  memberSwitch: 'components/member/announcement-emails.tsx',
  profile: 'app/(app)/(dashboard)/member/[orgSlug]/profile/page.tsx',
};

function code(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
const flat = (path: string) => code(path).replace(/\s+/g, '');

describe('making the send deliberate', () => {
  it('asks how many people before offering the button', () => {
    expect(flat(files.dialog)).toContain('api.commons.previewAnnouncement(orgId,postId,token)');
  });

  it('puts the number on the button itself', () => {
    // "Email all members" is an abstraction; "Send to 394" is a decision.
    expect(code(files.dialog)).toMatch(/Send to \{audience\?\.remaining/);
  });

  it('says it cannot be taken back', () => {
    // `&rsquo;` is longer than a straight apostrophe; match either.
    expect(code(files.dialog)).toMatch(/can(’|&rsquo;|')t be taken back/i);
  });

  it('offers nothing to send to when the audience is empty', () => {
    expect(flat(files.dialog)).toContain('audience.remaining===0');
  });

  it('cannot be dismissed mid-send', () => {
    // Closing the dialog does not stop the loop; letting it look as though
    // it does would be worse than keeping it open.
    expect(flat(files.dialog)).toContain('onClose={sending?()=>undefined:onClose}');
  });
});

describe('the composer', () => {
  it('writes the post before anything is emailed', () => {
    // The post is created, then the dialog opens against its id — so the
    // first reading of a typo is the organiser's own.
    const body = code(files.admin);
    const created = body.indexOf('api.commons.createPost');
    const emailed = body.indexOf('setEmailingPostId(post.id)');

    expect(created).toBeGreaterThan(-1);
    expect(emailed).toBeGreaterThan(created);
  });

  it('offers the option without performing it', () => {
    expect(code(files.admin)).toContain('Also email this to every member');
    expect(flat(files.admin)).toContain('checked={emailThisPost}');
  });

  it('clears the choice after one use, so the next post does not inherit it', () => {
    expect(flat(files.admin)).toContain('setEmailThisPost(false)');
  });
});

describe('the member’s way back in', () => {
  it('is on their profile', () => {
    expect(code(files.profile)).toContain('<AnnouncementEmails />');
  });

  it('reads the real setting rather than the default', () => {
    expect(flat(files.memberSwitch)).toContain('useState<boolean|null>(null)');
    expect(flat(files.memberSwitch)).toContain('api.commons.announcementEmails(orgId,token)');
  });

  it('takes the saved value back from the server', () => {
    expect(code(files.memberSwitch)).toMatch(/setOn\(saved\.announcementEmails\)/);
  });
});
