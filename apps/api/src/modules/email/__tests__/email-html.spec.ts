import { sanitizeEmailHtml } from '../email-html';

/**
 * An admin's words, on their way into somebody's mail client (CMN-21).
 *
 * Nothing on this side of the wire sanitised anything before: the web app
 * cleans a post as it renders a *page* (OPS-35), and an email never passes
 * through that. An announcement takes HTML composed in the browser and puts
 * it in four hundred inboxes.
 */
describe('cleaning an announcement for email', () => {
  it('keeps ordinary prose', () => {
    expect(sanitizeEmailHtml('<p>Potluck is <strong>tomorrow</strong> at 7.</p>')).toBe(
      '<p>Potluck is <strong>tomorrow</strong> at 7.</p>',
    );
  });

  it.each(['p', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'li', 'blockquote', 'code'])(
    'keeps <%s>',
    (tag) => {
      expect(sanitizeEmailHtml(`<${tag}>text</${tag}>`)).toContain(`<${tag}>`);
    },
  );

  it('keeps a line break and a rule', () => {
    expect(sanitizeEmailHtml('one<br>two<hr>')).toBe('one<br>two<hr>');
  });

  describe('things that must not reach a mail client', () => {
    it('removes a script and everything in it', () => {
      expect(sanitizeEmailHtml('<p>Hi</p><script>steal()</script>')).toBe('<p>Hi</p>');
    });

    it.each(['style', 'iframe', 'object', 'embed', 'form'])(
      'removes a <%s> and its contents',
      (tag) => {
        const out = sanitizeEmailHtml(`<p>Hi</p><${tag}>danger</${tag}>`);
        expect(out).not.toContain('danger');
        expect(out).not.toContain(`<${tag}`);
      },
    );

    it('strips an event handler rather than trusting the client to ignore it', () => {
      const out = sanitizeEmailHtml('<p onclick="steal()">Hi</p>');
      expect(out).not.toContain('onclick');
      expect(out).toContain('Hi');
    });

    it.each([
      ['javascript:', '<a href="javascript:steal()">tap</a>'],
      ['data:', '<a href="data:text/html,<script>x</script>">tap</a>'],
      ['vbscript:', '<a href="vbscript:x">tap</a>'],
    ])('drops a %s link but keeps the words', (_scheme, html) => {
      const out = sanitizeEmailHtml(html);
      expect(out).not.toMatch(/javascript:|data:|vbscript:/i);
      expect(out).toContain('tap');
    });

    it('drops a data: image, which is how a picture becomes a payload', () => {
      expect(sanitizeEmailHtml('<img src="data:text/html,evil">')).not.toContain('data:');
    });

    it('drops a plain http image, which half of clients warn about', () => {
      expect(sanitizeEmailHtml('<img src="http://x.org/a.png">')).not.toContain('http://');
    });
  });

  describe('things that should survive', () => {
    it('keeps an https link', () => {
      expect(sanitizeEmailHtml('<a href="https://maybeos.org/x">Open</a>')).toContain(
        'href="https://maybeos.org/x"',
      );
    });

    it('keeps a mailto link, so an announcement can point at a person', () => {
      expect(sanitizeEmailHtml('<a href="mailto:hello@maybeitsfate.com">Write</a>')).toContain(
        'mailto:hello@maybeitsfate.com',
      );
    });

    it('keeps an https image', () => {
      expect(sanitizeEmailHtml('<img src="https://maybeos.org/a.png" alt="A room">')).toContain(
        'src="https://maybeos.org/a.png"',
      );
    });
  });

  it('is safe on an empty or absent body', () => {
    expect(sanitizeEmailHtml('')).toBe('');
    expect(sanitizeEmailHtml(undefined as unknown as string)).toBe('');
  });

  it('leaves the words when the markup is nonsense', () => {
    // Somebody pasting from a word processor is the common case, not an attack.
    expect(sanitizeEmailHtml('<p>Bring <xyz>a dish</xyz></p>')).toBe('<p>Bring a dish</p>');
  });
});
