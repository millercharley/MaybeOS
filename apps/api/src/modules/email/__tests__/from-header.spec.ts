import { fromHeader } from '../from-header';

/**
 * Naming the sender (EML-01).
 *
 * The bug these exist for is not a crash. It is Microsoft accepting a message
 * with a clean `250` and then putting it nowhere the member can reach,
 * because a brand it cannot place arrived from a domain it cannot place. The
 * assertions below are therefore about what a receiving filter sees, and
 * about the one way a display name can do real harm: it is typed by an
 * organiser and spliced into a mail header.
 */
describe('building the From header', () => {
  it('puts the co-op’s name in front of the address', () => {
    expect(fromHeader('noreply@maybeos.org', 'MaybeItsFate')).toBe(
      'MaybeItsFate <noreply@maybeos.org>',
    );
  });

  it('falls back to the bare address when there is no name', () => {
    expect(fromHeader('noreply@maybeos.org')).toBe('noreply@maybeos.org');
    expect(fromHeader('noreply@maybeos.org', null)).toBe('noreply@maybeos.org');
    expect(fromHeader('noreply@maybeos.org', '   ')).toBe('noreply@maybeos.org');
  });

  describe('a name an organiser typed', () => {
    it('quotes one containing a comma', () => {
      expect(fromHeader('a@b.org', "Maybe, It's Fate")).toBe(`"Maybe, It's Fate" <a@b.org>`);
    });

    it.each([
      ['a dot', "St. Mark's"],
      ['a colon', 'Studio: North'],
      ['an at sign', 'Art @ Main'],
      ['angle brackets', 'The <Attic>'],
      ['a semicolon', 'One; Two'],
      ['parentheses', 'The Hall (East)'],
    ])('quotes one containing %s', (_why, name) => {
      expect(fromHeader('a@b.org', name)).toBe(`"${name}" <a@b.org>`);
    });

    it('escapes a quote rather than ending the string early', () => {
      expect(fromHeader('a@b.org', 'The "Big" Room')).toBe('"The \\"Big\\" Room" <a@b.org>');
    });

    it('escapes a backslash', () => {
      expect(fromHeader('a@b.org', 'A\\B')).toBe('"A\\\\B" <a@b.org>');
    });
  });

  /**
   * The security case.
   *
   * A newline in the display name would end the `From` header and let whoever
   * named the co-op add headers of their own — a `Bcc` on every message the
   * co-op sends. This is the only input on this path that a user controls.
   */
  describe('header injection', () => {
    it.each([
      ['a newline', 'Evil\nBcc: attacker@example.com'],
      ['a carriage return', 'Evil\rBcc: attacker@example.com'],
      ['a CRLF pair', 'Evil\r\nBcc: attacker@example.com'],
      ['a null byte', 'Evil\u0000Bcc: attacker@example.com'],
    ])('removes %s', (_why, name) => {
      const header = fromHeader('noreply@maybeos.org', name);

      expect(header).not.toMatch(/[\r\n\u0000]/);
      expect(header).toBe('"Evil Bcc: attacker@example.com" <noreply@maybeos.org>');
    });

    it('returns the bare address when the name was only control characters', () => {
      expect(fromHeader('a@b.org', '\r\n\u0000')).toBe('a@b.org');
    });
  });

  describe('a name that is not ASCII', () => {
    it('encodes it rather than emitting raw bytes', () => {
      const header = fromHeader('a@b.org', 'Café Münster');

      expect(header).toBe(
        `=?UTF-8?B?${Buffer.from('Café Münster', 'utf8').toString('base64')}?= <a@b.org>`,
      );
      // eslint-disable-next-line no-control-regex
      expect(header).not.toMatch(/[^\u0000-\u007F]/);
    });

    it('keeps the encoded word inside the 75 characters RFC 2047 allows', () => {
      const header = fromHeader('a@b.org', '日本語'.repeat(40));
      const word = header.slice(0, header.indexOf(' <'));

      expect(word.length).toBeLessThanOrEqual(75);
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    });

    it('never cuts a character in half', () => {
      const header = fromHeader('a@b.org', '🎭'.repeat(40));
      const base64 = header.slice('=?UTF-8?B?'.length, header.indexOf('?= <'));
      const decoded = Buffer.from(base64, 'base64').toString('utf8');

      // A truncation by bytes rather than code points leaves a replacement
      // character where half an emoji used to be.
      expect(decoded).not.toContain('�');
      expect(decoded).toBe('🎭'.repeat(Math.floor(45 / 4)));
    });
  });

  it('does not let a very long name run the header away', () => {
    const header = fromHeader('a@b.org', 'A'.repeat(500));
    expect(header.length).toBeLessThan(120);
  });
});
