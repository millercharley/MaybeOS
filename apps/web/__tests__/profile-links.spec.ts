import { isSafeProfileLink, profileLinkLabel, safeProfileLinks } from '@/lib/profile-links';

/**
 * A member's links are typed by one person and clicked by everyone else.
 *
 * They render as anchors on a page every member of the co-op reads, so the
 * failure this guards is not a broken link — it is script running in another
 * member's browser under the co-op's own domain, put there by filling in a
 * profile field. The API validates on the way in; this validates again on the
 * way out, because a row predating the rule, a bulk import, or a direct
 * database edit would otherwise reach an href unchecked.
 */
describe('profile links', () => {
  describe('what is safe to render', () => {
    it('allows the two schemes people actually use', () => {
      expect(isSafeProfileLink('https://www.instagram.com/millercharley/')).toBe(true);
      expect(isSafeProfileLink('http://example.org')).toBe(true);
    });

    it('refuses javascript:, which is the whole point', () => {
      expect(isSafeProfileLink('javascript:alert(document.cookie)')).toBe(false);
    });

    it('refuses data: and other exotic schemes', () => {
      expect(isSafeProfileLink('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isSafeProfileLink('vbscript:msgbox(1)')).toBe(false);
      expect(isSafeProfileLink('file:///etc/passwd')).toBe(false);
    });

    it('refuses a relative address, which would resolve inside MaybeOS', () => {
      // `/admin/settings` in a profile field should not become a link to the
      // reader's own admin area.
      expect(isSafeProfileLink('/admin/settings')).toBe(false);
      expect(isSafeProfileLink('evil.com')).toBe(false);
    });

    it('is not fooled by case or leading whitespace tricks', () => {
      expect(isSafeProfileLink('JaVaScRiPt:alert(1)')).toBe(false);
      expect(isSafeProfileLink('  javascript:alert(1)')).toBe(false);
    });
  });

  describe('filtering a stored list', () => {
    it('drops the unsafe and keeps the order of the rest', () => {
      const stored = [
        'https://thegistof.me/charley',
        'javascript:alert(1)',
        'https://www.linkedin.com/in/charleymiller/',
      ];

      expect(safeProfileLinks(stored)).toEqual([
        'https://thegistof.me/charley',
        'https://www.linkedin.com/in/charleymiller/',
      ]);
    });

    it('copes with nothing at all', () => {
      expect(safeProfileLinks(undefined)).toEqual([]);
      expect(safeProfileLinks(null)).toEqual([]);
    });
  });

  describe('how a link reads', () => {
    it('shows the address the way people write it', () => {
      expect(profileLinkLabel('https://www.instagram.com/millercharley/')).toBe(
        'instagram.com/millercharley',
      );
      expect(profileLinkLabel('https://thegistof.me/charley')).toBe('thegistof.me/charley');
    });

    it('keeps a bare domain readable', () => {
      expect(profileLinkLabel('https://example.org/')).toBe('example.org');
    });
  });
});
