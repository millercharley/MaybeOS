import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A post that was handed its files does not go and ask for them (CMN-28).
 *
 * This app's harness renders no components, so what is testable is the
 * contract in the source: that `files` short-circuits the fetch, and that an
 * empty array counts as an answer rather than an absence.
 *
 * The distinction is the whole fix. `[]` means "this post has none"; only
 * `undefined` means "the caller does not know" — which is still true of
 * comments and of the public event page, both of which still fetch.
 */
const COMPONENT = readFileSync(
  join(__dirname, '..', 'components', 'composer', 'attachment-list.tsx'),
  'utf8',
);
const FEED = readFileSync(
  join(__dirname, '..', 'app', '(app)', 'portal', '[orgSlug]', 'commons', 'page.tsx'),
  'utf8',
);

describe('AttachmentList', () => {
  it('has the files to read', () => {
    expect(COMPONENT).toContain('AttachmentList');
    expect(FEED).toContain('<AttachmentList');
  });

  it('skips the request when it was given the files', () => {
    expect(COMPONENT).toContain('if (given) return;');
  });

  /**
   * `files !== undefined`, not `files?.length` or a truthiness check. A post
   * with no attachments would otherwise fall through and fetch — which is
   * most posts, and would have left the N+1 almost entirely in place.
   */
  it('treats an empty list as an answer, not an absence', () => {
    expect(COMPONENT).toContain('files !== undefined');
    expect(COMPONENT).not.toMatch(/const given = files\?\./);
    expect(COMPONENT).not.toMatch(/const given = Boolean\(files\)/);
    expect(COMPONENT).not.toMatch(/const given = files\.length/);
  });

  /** The feed hands them over; that is what removes the per-post request. */
  it('is given the post’s files by the Commons feed', () => {
    expect(FEED).toMatch(/files=\{post\.attachments\}/);
  });

  /**
   * Comments keep fetching their own. They arrive from a different endpoint
   * and are opened one thread at a time, so there is no burst to collapse —
   * and the fallback has to keep working for them.
   */
  it('still fetches where the caller does not know', () => {
    expect(COMPONENT).toContain('api.attachments.list');
    expect(COMPONENT).toContain('api.attachments.publicEventFiles');
    // `[\s\S]` rather than the `s` flag, which this tsconfig's target does
    // not allow — jest accepted it and `tsc` did not.
    expect(FEED).toMatch(/<AttachmentList[\s\S]*?commentId=\{comment\.id\}/);
  });
});
