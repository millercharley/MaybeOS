import { readFileSync } from 'fs';
import { join } from 'path';
import { plainTextOf } from '../plain-text';
import { stripComments } from '../testing/source-scan';

const read = (...p: string[]) =>
  readFileSync(join(__dirname, '..', '..', ...p), 'utf8');

/**
 * A member's rich text, reduced to words (CMN-31).
 *
 * Reported by Charley on 20 November with a screenshot of the email a member
 * actually received: the notification opened with a literal `<p>` and went on
 * to show `</p> <ol> <li>` in the middle of a sentence.
 */
describe('plainTextOf', () => {
  /*
    The message from the screenshot, as the composer stores it. The assertion
    is the whole bug: no angle bracket survives, and the words read as the
    member wrote them.
  */
  it('turns the message that was reported into something readable', () => {
    const body =
      '<p>Hey Charlie! Thank you so much for approving the Main Gallery for our ' +
      'BYS JAM Member Pop-up on December 12 from 9 AM to 6 PM!</p> <ol> <li>Our ' +
      'member would love to serve small bites to guests.</li> <li>Is food allowed ' +
      'in the gallery?</li> </ol>';

    const text = plainTextOf(body);

    expect(text).not.toMatch(/[<>]/);
    expect(text).toBe(
      'Hey Charlie! Thank you so much for approving the Main Gallery for our ' +
        'BYS JAM Member Pop-up on December 12 from 9 AM to 6 PM! Our member would ' +
        'love to serve small bites to guests. Is food allowed in the gallery?',
    );
  });

  it('does not run two blocks into one word', () => {
    expect(plainTextOf('<p>Hello</p><p>There</p>')).toBe('Hello There');
    expect(plainTextOf('<li>One</li><li>Two</li>')).toBe('One Two');
    expect(plainTextOf('Line<br>Break')).toBe('Line Break');
  });

  it('keeps the words out of a link, not the markup', () => {
    expect(plainTextOf('See <a href="https://example.com">the gallery</a> now')).toBe(
      'See the gallery now',
    );
  });

  it.each([
    ['&amp;', 'Bread &amp; butter', 'Bread & butter'],
    ['&nbsp;', 'a&nbsp;b', 'a b'],
    ['&quot;', 'He said &quot;yes&quot;', 'He said "yes"'],
    ['&#39;', 'It&#39;s fine', "It's fine"],
  ])('decodes %s', (_label, input, expected) => {
    expect(plainTextOf(input)).toBe(expected);
  });

  /*
    Order matters and is easy to get backwards. Decoding before stripping
    would turn this into a real tag and then delete it, silently eating text
    the member typed — so the escaped form has to survive as visible text.
  */
  it('does not eat text a member escaped on purpose', () => {
    expect(plainTextOf('<p>Use &lt;b&gt; for bold</p>')).toBe('Use <b> for bold');
  });

  it('collapses whitespace and trims, as the email needs one line', () => {
    expect(plainTextOf('  Hello\n\n   there  ')).toBe('Hello there');
  });

  it('is unbothered by plain text that was never HTML', () => {
    expect(plainTextOf('Can you cover the Attic on Thursday?')).toBe(
      'Can you cover the Attic on Thursday?',
    );
  });

  it('answers empty for a body that was only markup', () => {
    expect(plainTextOf('<p></p><br>')).toBe('');
  });
});

/**
 * The reason this function exists rather than three copies of it.
 *
 * `excerptOf` had the conversion right for comment replies and said so in its
 * docblock. The direct-message preview and the digest's untitled-post
 * fallback were written separately and never got it — so the bug shipped in
 * two of the three places that needed the same five lines.
 */
describe('every email that shows a member’s rich text converts it first', () => {
  it.each([
    ['direct message preview', ['modules', 'commons', 'message-notifications.ts']],
    ['comment reply excerpt', ['modules', 'commons', 'thread-policy.ts']],
    ['weekly digest', ['modules', 'email', 'email.service.ts']],
  ])('%s', (_label, path) => {
    expect(stripComments(read(...(path as string[])))).toMatch(/plainTextOf\(/);
  });

  it('the digest converts the body it falls back to when a post has no title', () => {
    const src = stripComments(read('modules', 'email', 'email.service.ts'));
    expect(src).toMatch(/post\.title \|\| clamp\(plainTextOf\(post\.body\), 90\)/);
    // The shape that caused it: the raw body straight into clamp.
    expect(src).not.toMatch(/clamp\(post\.body,/);
  });
});
