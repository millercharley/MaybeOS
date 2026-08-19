import { looksLikeHtml, renderBodyHtml, isBlankBody } from '@/lib/rich-text';

/**
 * Rich bodies, without breaking the plain ones already stored.
 *
 * Posts, comments and messages were plain text and are now HTML. Nothing was
 * migrated, because rewriting a co-op's own words to add markup is worse than
 * telling the two apart — so every read path handles both, forever.
 *
 * The other half is that a body is whatever a browser sent, and a browser is
 * not a trusted source: a comment is written by one member and read by all of
 * them, so the sanitiser is the boundary.
 */
describe('member-written bodies', () => {
  describe('telling rich from plain', () => {
    it('recognises what the composer produces', () => {
      expect(looksLikeHtml('<p>Bring a craft</p>')).toBe(true);
      expect(looksLikeHtml('see you there <strong>Tuesday</strong>')).toBe(true);
    });

    it('does not treat arithmetic as markup', () => {
      // The failure this prevents: "a < b" being read as an unclosed tag and
      // half the message vanishing into a sanitiser.
      expect(looksLikeHtml('a < b and b > c')).toBe(false);
      expect(looksLikeHtml('the kiln runs <8 hours')).toBe(false);
    });
  });

  describe('rendering', () => {
    it('keeps the formatting a member applied', () => {
      expect(renderBodyHtml('<p>Bring a <strong>craft</strong></p>')).toContain('<strong>');
    });

    it('strips script from a body that reached the database another way', () => {
      // The API is the gate, not the guarantee — an import or a direct edit
      // does not pass through it.
      const rendered = renderBodyHtml('<p>hi</p><script>alert(1)</script>');
      expect(rendered).not.toContain('<script');
      expect(rendered).toContain('hi');
    });

    it('escapes plain text rather than sanitising it', () => {
      expect(renderBodyHtml('a < b')).toBe('a &lt; b');
    });

    it('does not let a plain-text message forge markup', () => {
      const rendered = renderBodyHtml('nice try <script>alert(1)</script>');
      expect(rendered).toContain('&lt;script&gt;');
      expect(rendered).not.toContain('<script>');
    });
  });

  describe('whether there is anything to send', () => {
    it('treats an emptied composer as blank', () => {
      // A contenteditable that has been focused and cleared still holds these,
      // so length alone would leave Send enabled on an empty box.
      expect(isBlankBody('<p><br></p>')).toBe(true);
      expect(isBlankBody('<p>&nbsp;</p>')).toBe(true);
      expect(isBlankBody('')).toBe(true);
    });

    it('treats real content as content', () => {
      expect(isBlankBody('<p>ok</p>')).toBe(false);
    });
  });
});
