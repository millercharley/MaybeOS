import { addresses } from '../email.service';

/**
 * Where one person's mail goes (MEM-19).
 *
 * MaybeItsFate's roster has people billed at one address and signed up to its
 * forum at another — the same person, two records, and nothing in either file
 * says which one they still read. Choosing wrong is invisible: the sign-in
 * link goes somewhere nobody looks, and the member concludes MaybeOS does not
 * work rather than that MaybeOS has the wrong address.
 */
describe('the addresses one member reads', () => {
  it('takes a plain string as it always did', () => {
    expect(addresses('ada@example.com')).toEqual({ primary: 'ada@example.com' });
  });

  it('copies the second address when there is one', () => {
    expect(addresses({ primary: 'billed@example.com', also: 'forum@example.com' })).toEqual({
      primary: 'billed@example.com',
      also: 'forum@example.com',
    });
  });

  it('never copies somebody on their own mail', () => {
    // The common case after an import: both files held the same address, and
    // a Cc to yourself looks like a bug to the person receiving it.
    expect(addresses({ primary: 'ada@example.com', also: 'ada@example.com' })).toEqual({
      primary: 'ada@example.com',
    });
  });

  it('ignores case when deciding they are the same person', () => {
    expect(addresses({ primary: 'Ada@Example.com', also: 'ada@example.com' })).toEqual({
      primary: 'Ada@Example.com',
    });
  });

  it('treats a blank or missing second address as none', () => {
    expect(addresses({ primary: 'ada@example.com', also: '   ' })).toEqual({
      primary: 'ada@example.com',
    });
    expect(addresses({ primary: 'ada@example.com', also: null })).toEqual({
      primary: 'ada@example.com',
    });
    expect(addresses({ primary: 'ada@example.com' })).toEqual({ primary: 'ada@example.com' });
  });

  it('trims what a spreadsheet left behind', () => {
    expect(addresses({ primary: ' billed@example.com ', also: ' forum@example.com ' })).toEqual({
      primary: 'billed@example.com',
      also: 'forum@example.com',
    });
  });
});
