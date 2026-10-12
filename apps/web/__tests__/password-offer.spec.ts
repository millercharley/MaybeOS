import { readFileSync } from 'fs';
import { join } from 'path';
import { offerPassword, readPrompt, settlePrompt } from '@/lib/password-prompt';

/**
 * Asking once, at the moment it makes sense (AUTH-05).
 *
 * Charley: "build the prompt after magic-link sign-in."
 *
 * AUTH-04 made creating a password possible. This is what makes anyone aware
 * of it: 433 of MaybeItsFate's 439 members sign in with a link, and profile
 * settings only serves people who already suspect the option is there.
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

beforeEach(() => window.localStorage.clear());

describe('when to ask', () => {
  it('asks nothing of somebody who has not just followed a link', () => {
    expect(readPrompt()).toBe('none');
  });

  it('raises the offer after a sign-in link', () => {
    offerPassword();
    expect(readPrompt()).toBe('offer');
  });

  it('never asks again once declined', () => {
    /*
      The difference between an offer and a nag. Somebody who signs in with a
      link every week would otherwise be asked every week — and a sign-in
      link is a complete way to use MaybeOS, not a lesser one.
    */
    offerPassword();
    settlePrompt();
    offerPassword();

    expect(readPrompt()).toBe('dismissed');
  });

  it('stays quiet when storage will not have it', () => {
    // Private windows throw on both read and write. An offer is not worth a
    // crash on every page of the product.
    const broken = () => {
      throw new Error('denied');
    };
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(broken);
    const setter = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(broken);

    expect(readPrompt()).toBe('none');
    expect(() => offerPassword()).not.toThrow();
    expect(() => settlePrompt()).not.toThrow();

    spy.mockRestore();
    setter.mockRestore();
  });

  it('ignores a value it did not write', () => {
    window.localStorage.setItem('maybeos.password-prompt', 'yes please');
    expect(readPrompt()).toBe('none');
  });
});

describe('who gets asked', () => {
  const magicLink = strip(read('app', '(auth)', 'magic-link', 'page.tsx'));

  it('only somebody who has no password', () => {
    // Offering a password to somebody who has one is a banner that is simply
    // wrong, and `hasPassword` may be undefined against an older API — so
    // this tests for false rather than falsiness.
    expect(magicLink).toMatch(/user\.hasPassword === false\) offerPassword\(\)/);
  });

  it('is asked on the page they land on, not the one that redirects', () => {
    const shell = strip(read('app', '(app)', 'layout.tsx'));
    expect(shell).toMatch(/<PasswordOffer/);
    expect(magicLink).not.toMatch(/<PasswordOffer/);
  });
});

describe('the banner', () => {
  const src = strip(read('components', 'member', 'password-offer.tsx'));
  const shell = strip(read('app', '(app)', 'layout.tsx'));
  const form = strip(read('components', 'member', 'change-password.tsx'));

  it('can be declined, and stays declined', () => {
    expect(src).toMatch(/settlePrompt\(\)/);
    expect(src).toMatch(/aria-label="Not now"/);
  });

  it('blocks nothing', () => {
    // Not a modal, not a redirect, not a gate on the page behind it.
    expect(src).not.toMatch(/Modal|fixed inset-0|router\.(push|replace)/);
  });

  it('reads storage in an effect, not during render', () => {
    // There is no localStorage on the server, and reading it while
    // rendering makes the first client paint disagree with the markup.
    expect(src).toMatch(/useEffect\(\(\) => setShow\(readPrompt\(\) === 'offer'\), \[\]\)/);
  });

  it('says the link keeps working', () => {
    // Nobody should think adding a password takes their sign-in link away.
    expect(src).toMatch(/the link keeps\s+working/);
  });

  it('stays off the screen that already carries the offer', () => {
    expect(shell).toMatch(/!pathname\?\.endsWith\('\/profile'\)/);
  });

  it('goes away for good once a password exists', () => {
    // Otherwise it would keep offering something already done.
    expect(form).toMatch(/settlePrompt\(\)/);
  });

  it('does not point nowhere when it has no co-op to point at', () => {
    expect(src).toMatch(/!profileHref\) return null/);
  });
});
