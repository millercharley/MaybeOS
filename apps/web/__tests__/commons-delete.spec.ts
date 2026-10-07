import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * An admin can take anything down (CMN-18).
 *
 * Before this there was no way to remove anything from the Commons: flagging
 * was the only moderation it had, and `isFlagged` was read by nothing — a
 * flagged post stayed where it was. An admin's choice was to delete a whole
 * channel or to leave it.
 *
 * Source scans, like every other page test here: the rule being pinned is who
 * is offered the button, and that is visible in the source.
 */
const read = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', ...parts), 'utf8')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

const adminCommons = read('app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'commons', 'page.tsx');
const portalCommons = read('app', '(app)', 'portal', '[orgSlug]', 'commons', 'page.tsx');
const client = read('lib', 'api.ts');

describe('the admin Commons', () => {
  it('offers delete on a post and on a comment', () => {
    expect(adminCommons).toMatch(/>\s*Delete post\s*</);
    expect(adminCommons).toMatch(/>\s*Delete\s*</);
  });

  it('offers it to an admin, and to whoever wrote it', () => {
    /*
      Two rights reaching the same button (CMN-19).

      An admin takes down anybody's: the co-op removing something. An author
      takes down their own: a person withdrawing what they said. The server
      checks both; this is only whether to draw the control.
    */
    expect(adminCommons).toMatch(/\(isAdmin \|\| post\.author\?\.id === user\?\.id\) && \(/);
    expect(adminCommons).toMatch(/canDelete=\{isAdmin\}/);
    expect(adminCommons).toMatch(/\(canDelete \|\| isAuthor\) && onDelete/);
  });

  it('confirms before deleting, rather than on the click', () => {
    // It removes somebody else's words, takes their replies and files with
    // them, and cannot be undone.
    expect(adminCommons).toMatch(/setRemoving\(\{/);
    expect(adminCommons).toMatch(/<Modal/);
    expect(adminCommons).toMatch(/Keep it/);
  });

  it('says what else goes, not just "are you sure"', () => {
    expect(adminCommons).toMatch(/every comment and reply under it/);
    expect(adminCommons).toMatch(/any files attached/);
  });

  it('tells the admin it is recorded', () => {
    expect(adminCommons).toMatch(/audit log/i);
  });

  it('closes the open post when that post is the one deleted', () => {
    // Nothing can be read from it now.
    expect(adminCommons).toMatch(/expandedPostId === removing\.id\) setExpandedPostId\(null\)/);
  });

  it('passes the delete down to nested replies', () => {
    // CommentThread renders itself for each reply; a prop that stopped at the
    // top level would offer the button only on first-level comments.
    expect(adminCommons).toMatch(/onDelete=\{onDelete\}/);
  });
});

describe('the Commons a member reads', () => {
  it('offers an admin the same deletes there', () => {
    // This is where an admin actually reads the conversation; moderating
    // should not mean going to find another screen.
    expect(portalCommons).toMatch(/api\.commons\.deletePost/);
    expect(portalCommons).toMatch(/api\.commons\.deleteComment/);
  });

  it('offers a member the delete on their own words', () => {
    // CMN-19. The right an author already had for editing.
    expect(portalCommons).toMatch(/const canDelete = isAuthor \|\| isAdmin/);
    expect(portalCommons).toMatch(/const canDelete = wroteIt \|\| isAdmin/);
  });

  it('works out admin from this co-op’s role, not a global one', () => {
    expect(portalCommons).toMatch(/orgs\?\.find\(\(o\) => o\.orgId === orgId\)\?\.role === 'ADMIN'/);
    expect(portalCommons).toMatch(/orgs\?\.find\(\(o\) => o\.orgId === org\.id\)\?\.role === 'ADMIN'/);
  });

  it('puts the count in the question', () => {
    // A post takes its whole thread with it.
    expect(portalCommons).toMatch(/Delete this post and the \$\{commentCount\}/);
    expect(portalCommons).toMatch(/cannot be undone/);
  });

  it('reloads rather than splicing the row out', () => {
    // The feed is paged; dropping a row locally would leave the count wrong.
    expect(portalCommons).toMatch(/onDeleted=\{\(\) => selectedChannel && loadPosts\(selectedChannel\)\}/);
  });
});

describe('the client', () => {
  it('deletes through DELETE, not a flag', () => {
    expect(client).toMatch(/deletePost:[\s\S]{0,200}method: 'DELETE'/);
    expect(client).toMatch(/deleteComment:[\s\S]{0,200}method: 'DELETE'/);
  });

  it('keeps editing separate from deleting', () => {
    // Editing is authorship and stays with the author whatever their rank.
    // Deleting is the co-op removing something.
    expect(client).toMatch(/editComment:[\s\S]{0,200}method: 'PATCH'/);
  });
});
