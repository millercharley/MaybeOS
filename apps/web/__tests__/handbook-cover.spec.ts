import { HANDBOOK_COVER_ASPECT } from '@/lib/image-crop';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A Handbook cover is a banner, and adding one does not eat what you typed
 * (BEL-11).
 *
 * Two complaints, one screen. The image was shown as a tight zoom of the
 * middle of a 1080×340 source, because every image chosen through
 * `ImageUploader` was cropped to 3:2 — right for a room photo, wrong for a
 * masthead — and then cropped *again* by a `max-h` in three different places,
 * none of which agreed with each other or with the crop.
 *
 * And uploading one lost the admin's unsaved title and body, because the
 * upload handler replaced the whole article with the server's copy.
 *
 * There is no React test harness in this app, so these read the source. That
 * is a weak test of behaviour and a strong test of the two specific mistakes:
 * a second crop reappearing, and the whole article being taken back from the
 * server.
 */
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

describe('the shape of a Handbook cover', () => {
  it('is a banner, not a photograph', () => {
    // 3:1. The source Charley compared against is 1080×340, and Circle shows
    // it whole at about the same ratio.
    expect(HANDBOOK_COVER_ASPECT).toBe(3);
  });

  it('is the same number in the crop, the preview and the page', () => {
    // The argument for cropping up front (SPC-17) is that what the co-op
    // frames is what members see. Three different heights broke that.
    const admin = read('app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'handbook', 'page.tsx');
    const modal = read('components', 'belonging', 'article-modal.tsx');
    const start = read('app', '(app)', 'portal', '[orgSlug]', 'handbook', 'start', 'page.tsx');

    expect(admin).toContain('aspect={HANDBOOK_COVER_ASPECT}');
    for (const source of [modal, start]) {
      expect(source).toContain('aspectRatio: String(HANDBOOK_COVER_ASPECT)');
      // The second crop that hid the framing.
      expect(source).not.toMatch(/coverImageUrl[\s\S]{0,200}max-h-/);
    }
  });

  it('does not crop the admin’s preview to a different height again', () => {
    const uploader = read('components', 'ui', 'image-uploader.tsx');
    expect(uploader).toContain('aspectRatio: String(aspect)');
    // In a class attribute, not in the comment that explains why it is gone.
    expect(uploader).not.toMatch(/className="[^"]*max-h-56/);
  });
});

describe('uploading a cover', () => {
  const admin = read('app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'handbook', 'page.tsx');

  it('keeps what the admin has typed', () => {
    // The bug in one line: `setEditing(await uploadArticleCover(...))` takes
    // the server's copy, which holds the last *saved* title and body.
    expect(admin).not.toMatch(/setEditing\(\s*await api\.belonging\.uploadArticleCover/);
    expect(admin).toContain('coverImageUrl: saved.coverImageUrl');
  });

  it('takes only the cover back from the server', () => {
    // Both handlers merge into the current draft rather than replacing it.
    const merges = admin.match(/setEditing\(\(current\)/g) ?? [];
    expect(merges.length).toBe(2);
  });
});
