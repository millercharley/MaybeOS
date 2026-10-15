import { safeReplyTo } from '../reply-to';

/**
 * Where a member's reply goes (EML-03).
 *
 * This value is typed by an organiser and interpolated into a mail header,
 * which makes it the same class of input as the From display name: the
 * injection cases below are the reason this function exists at all, not an
 * afterthought about validation.
 */
describe('choosing a Reply-To address', () => {
  it('keeps an ordinary address', () => {
    expect(safeReplyTo('hello@maybeitsfate.com')).toBe('hello@maybeitsfate.com');
  });

  it.each([
    ['a plus tag', 'hello+members@maybeitsfate.com'],
    ['a dotted local part', 'first.last@maybeitsfate.com'],
    ['a hyphenated domain', 'hello@maybe-its-fate.com'],
    ['a subdomain', 'hello@mail.maybeitsfate.com'],
    ['a long TLD', 'hello@maybeitsfate.community'],
  ])('keeps %s', (_why, address) => {
    expect(safeReplyTo(address)).toBe(address);
  });

  it('trims surrounding whitespace', () => {
    expect(safeReplyTo('  hello@maybeitsfate.com  ')).toBe('hello@maybeitsfate.com');
  });

  describe('no address means no header', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty', ''],
      ['whitespace', '   '],
    ])('returns null for %s', (_why, value) => {
      expect(safeReplyTo(value)).toBeNull();
    });
  });

  /**
   * The reason this is a function and not a cast.
   *
   * A newline here would end the `Reply-To` header and let whoever typed it
   * append headers of their own — a `Bcc` on every message the co-op sends.
   * Refused outright rather than stripped: unlike a display name, which is
   * prose that may legitimately contain odd whitespace, a control character
   * in an address is not a typo.
   */
  describe('header injection', () => {
    it.each([
      ['a newline', 'a@b.com\nBcc: attacker@example.com'],
      ['a carriage return', 'a@b.com\rBcc: attacker@example.com'],
      ['a CRLF pair', 'a@b.com\r\nBcc: attacker@example.com'],
      ['a null byte', 'a@b.com\u0000Bcc: attacker@example.com'],
    ])('refuses %s', (_why, value) => {
      expect(safeReplyTo(value)).toBeNull();
    });

    /*
      Surrounding newlines are trimmed, not refused, and that is safe: what
      is left carries no control character, so the header it produces is an
      ordinary one. Asserted rather than left implicit, because "we refuse
      anything containing a newline" is the easy thing to believe about this
      function and it is not what it does.
    */
    it('trims a surrounding newline and keeps the address', () => {
      expect(safeReplyTo('\na@b.com\n')).toBe('a@b.com');
    });

    it('refuses a list rather than passing several addresses through', () => {
      expect(safeReplyTo('a@b.com, attacker@example.com')).toBeNull();
      expect(safeReplyTo('a@b.com; attacker@example.com')).toBeNull();
    });

    it('refuses a display-name form, which could carry brackets', () => {
      expect(safeReplyTo('Someone <a@b.com>')).toBeNull();
    });
  });

  describe('things that are not addresses', () => {
    it.each([
      ['no at sign', 'hello.maybeitsfate.com'],
      ['no domain', 'hello@'],
      ['no local part', '@maybeitsfate.com'],
      ['no TLD', 'hello@localhost'],
      ['a single-letter TLD', 'hello@maybeitsfate.c'],
      ['two at signs', 'a@b@c.com'],
      ['a space inside', 'hel lo@maybeitsfate.com'],
      ['a bare word', 'noreply'],
      ['a URL', 'https://maybeitsfate.com'],
    ])('refuses %s', (_why, value) => {
      expect(safeReplyTo(value)).toBeNull();
    });

    it('refuses an address longer than RFC 5321 allows', () => {
      expect(safeReplyTo(`${'a'.repeat(250)}@maybeitsfate.com`)).toBeNull();
    });
  });
});
