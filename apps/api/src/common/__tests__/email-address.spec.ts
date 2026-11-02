import { normalizeEmail, normalizeEmailOrNull } from '../email-address';

/**
 * One spelling of an email address (AUTH-07).
 *
 * A member typed their own address with a capital letter, MaybeOS did not
 * recognise them, offered to start a co-op instead, and they took it — two
 * accounts, two passwords, and a duplicate of their own community, with
 * nothing anywhere reporting a fault.
 */
describe('normalising an address', () => {
  it('lowercases it', () => {
    expect(normalizeEmail('Wren.oakes@example.net')).toBe('wren.oakes@example.net');
  });

  it('lowercases the domain as well as the local part', () => {
    expect(normalizeEmail('Wren@Example.NET')).toBe('wren@example.net');
  });

  it('trims the whitespace a paste leaves behind', () => {
    expect(normalizeEmail('  wren@example.net \n')).toBe('wren@example.net');
  });

  it('makes the two spellings that caused this agree', () => {
    expect(normalizeEmail('Wren.oakes@example.net')).toBe(
      normalizeEmail('wren.oakes@example.net'),
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
  ])('returns an empty string for %s', (_why, value) => {
    expect(normalizeEmail(value)).toBe('');
  });

  /**
   * Deliberately not clever. Gmail ignores dots and everybody's `+` rules
   * differ; a wrong merge here joins two people's accounts, which is worse in
   * kind than leaving two rows for somebody to look at.
   */
  it('does not strip dots', () => {
    expect(normalizeEmail('wren.l.oakes@example.com')).toBe('wren.l.oakes@example.com');
  });

  it('does not collapse a plus alias', () => {
    expect(normalizeEmail('wren+maybeos@example.net')).toBe('wren+maybeos@example.net');
  });

  it('keeps two genuinely different people apart', () => {
    expect(normalizeEmail('wren@a.org')).not.toBe(normalizeEmail('wren@b.org'));
  });
});

describe('normalising something that may be absent', () => {
  it('keeps a real address', () => {
    expect(normalizeEmailOrNull(' Wren@Example.net ')).toBe('wren@example.net');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '  '],
  ])('answers null for %s, not an empty string', (_why, value) => {
    // `altEmail` is null for most members, and that is not the same as blank.
    expect(normalizeEmailOrNull(value)).toBeNull();
  });
});
