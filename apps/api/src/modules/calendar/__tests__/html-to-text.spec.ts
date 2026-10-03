import { htmlToText } from '../html-to-text';

/**
 * A Google Calendar description, as text (CAL-10).
 *
 * MaybeItsFate's 777 imported events arrived with their markup showing —
 * `<div><p><a href="https://www.tixtree.com/...">Reserve tickets!</a></p>` on
 * the event page, in front of the whole co-op. Google stores descriptions as
 * HTML; MaybeOS writes and reads them as text.
 */

describe('turning a calendar description into text', () => {
  it('leaves alone something nobody marked up', () => {
    // Most calendars are written by people typing into a box.
    expect(htmlToText('Bring a mat and water.')).toBe('Bring a mat and water.');
  });

  it('keeps a link’s words and its address', () => {
    // "Reserve tickets!" with the URL thrown away is a sentence about a thing
    // nobody can reach.
    expect(
      htmlToText('<p><a href="https://tixtree.com/e/abc" target="_blank">Reserve tickets!</a></p>'),
    ).toBe('Reserve tickets! (https://tixtree.com/e/abc)');
  });

  it('does not write an address out twice', () => {
    expect(htmlToText('<a href="https://example.com">https://example.com</a>')).toBe(
      'https://example.com',
    );
  });

  it('keeps the paragraphs somebody wrote', () => {
    expect(htmlToText('<p>First thing.</p><p>Second thing.</p>')).toBe(
      'First thing.\n\nSecond thing.',
    );
  });

  it('turns a line break into one', () => {
    expect(htmlToText('Doors 7pm<br>Music 8pm')).toBe('Doors 7pm\nMusic 8pm');
  });

  it('marks a list so it still reads as one', () => {
    expect(htmlToText('<ul><li>Mat</li><li>Water</li></ul>')).toBe('• Mat\n\n• Water');
  });

  it('decodes the entities Google writes', () => {
    expect(htmlToText('Tea &amp; biscuits &mdash; 7&nbsp;pm')).toBe('Tea & biscuits — 7 pm');
    expect(htmlToText('Caf&#233; &#x2014; upstairs')).toBe('Café — upstairs');
  });

  it('does not carry script or style through as prose', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Hello</p>')).toBe('Hello');
    expect(htmlToText('<script>alert(1)</script><p>Hello</p>')).toBe('Hello');
  });

  it('does not leave a wall of blank lines behind the tags', () => {
    expect(htmlToText('<div><p>One</p></div><div><p>Two</p></div>')).toBe('One\n\nTwo');
  });

  it('says nothing rather than empty', () => {
    expect(htmlToText('')).toBeNull();
    expect(htmlToText(null)).toBeNull();
    expect(htmlToText(undefined)).toBeNull();
    expect(htmlToText('<p></p>')).toBeNull();
    expect(htmlToText('   ')).toBeNull();
  });

  it('handles the real one Charley showed me', () => {
    const real =
      '<div><p><a href="https://www.tixtree.com/e/music-in-the-attic-jg-shadid-5d613bdf6755" ' +
      'target="_blank" rel="noopener noreferrer">Reserve tickets!</a></p><p>JG Shadid is an EMMY ' +
      'NOMINATED composer, producer, multi-instrumentalist, and educator.</p></div>';

    expect(htmlToText(real)).toBe(
      'Reserve tickets! (https://www.tixtree.com/e/music-in-the-attic-jg-shadid-5d613bdf6755)\n\n' +
        'JG Shadid is an EMMY NOMINATED composer, producer, multi-instrumentalist, and educator.',
    );
  });
});
