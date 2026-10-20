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
    expect(normalizeEmail('Jonleecope@bellsouth.net')).toBe('jonleecope@bellsouth.net');
  });

  it('lowercases the domain as well as the local part', () => {
    expect(normalizeEmail('Jon@BellSouth.NET')).toBe('jon@bellsouth.net');
  });

  it('trims the whitespace a paste leaves behind', () => {
    expect(normalizeEmail('  jon@bellsouth.net \n')).toBe('jon@bellsouth.net');
  });

  it('makes the two spellings that caused this agree', () => {
    expect(normalizeEmail('Jonleecope@bellsouth.net')).toBe(
      normalizeEmail('jonleecope@bellsouth.net'),
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
    expect(normalizeEmail('jon.lee.cope@gmail.com')).toBe('jon.lee.cope@gmail.com');
  });

  it('does not collapse a plus alias', () => {
    expect(normalizeEmail('jon+maybeos@bellsouth.net')).toBe('jon+maybeos@bellsouth.net');
  });

  it('keeps two genuinely different people apart', () => {
    expect(normalizeEmail('jon@a.org')).not.toBe(normalizeEmail('jon@b.org'));
  });
});

describe('normalising something that may be absent', () => {
  it('keeps a real address', () => {
    expect(normalizeEmailOrNull(' Jon@Bellsouth.net ')).toBe('jon@bellsouth.net');
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
