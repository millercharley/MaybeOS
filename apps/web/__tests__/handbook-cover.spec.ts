import { HANDBOOK_COVER_ASPECT, focusOffsetPct, focusWindowPct } from '@/lib/image-crop';
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

  it('merges into the draft rather than replacing it', () => {
    // Counting the merges was the first version of this, and adding an
    // unrelated third one broke it — a test that fails on a correct change is
    // asserting the wrong thing. What matters is that both cover handlers
    // keep the current draft.
    expect(admin).toContain('{ ...current, coverImageUrl: saved.coverImageUrl }');
    expect(admin).toContain('{ ...current, coverImageUrl: null }');
  });
});

/**
 * The square beside each row (BEL-12).
 *
 * The index showed the author's avatar, so a Handbook written by one admin was
 * eight rows of the same face — a picture that told you nothing about which
 * article you were looking at.
 */
describe('the Handbook index thumbnail', () => {
  const row = read('components', 'belonging', 'article-row.tsx');
  const focus = read('components', 'belonging', 'cover-focus.tsx');

  it('is the article’s own banner, squared', () => {
    expect(row).toContain('article.coverImageUrl ?');
    expect(row).toMatch(/h-11 w-11 shrink-0 rounded-lg object-cover/);
  });

  it('shows the part of the banner the admin chose', () => {
    expect(row).toContain('objectPosition: `${article.coverFocusX ?? 50}% 50%`');
  });

  it('falls back to the author for an article with no banner', () => {
    // A face is better than an empty box.
    expect(row).toContain('article.author?.avatarUrl');
  });

  it('lets the admin see what they are choosing from and what they will get', () => {
    // The image with the square marked on it, and the square itself at the
    // size it renders. Either alone leaves them guessing.
    expect(focus).toContain('aspectRatio: String(aspect)');
    expect(focus).toContain('h-11 w-11');
  });

  /*
    The marquee arithmetic used to be asserted by matching the literal
    expression in the source, which broke the moment the component was
    generalised for room photos (SPC-19) — behaviour unchanged, test red. It
    is a pure function now, so this tests what it computes.
  */
  it('marks a window the size of the crop it will take', () => {
    // A square is a third of a 3:1 banner and two thirds of a 3:2 photo.
    expect(focusWindowPct(3)).toBeCloseTo(33.333, 2);
    expect(focusWindowPct(3 / 2)).toBeCloseTo(66.667, 2);
  });

  it('keeps the marquee inside the image at both ends', () => {
    // Sliding to a literal 100% would hang it off the end.
    expect(focusOffsetPct(0, 3)).toBe(0);
    expect(focusOffsetPct(100, 3)).toBeCloseTo(66.667, 2);
    expect(focusOffsetPct(100, 3) + focusWindowPct(3)).toBeCloseTo(100, 6);
    expect(focusOffsetPct(50, 3) + focusWindowPct(3) / 2).toBeCloseTo(50, 6);
  });

  it('clamps a focus outside the range rather than sliding off', () => {
    expect(focusOffsetPct(-20, 3)).toBe(0);
    expect(focusOffsetPct(140, 3)).toBeCloseTo(66.667, 2);
  });
});
