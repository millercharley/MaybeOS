import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A way in that is not email (MEM-29).
 *
 * Microsoft accepts MaybeOS mail with a clean `250` and then suppresses it —
 * Postmark reports `Delivered`, and the member's inbox and junk folder are
 * both empty. For those members a magic link cannot be emailed, so an
 * organiser mints one and hands it over.
 *
 * The link signs its holder in as that member, which makes two things worth
 * pinning in the UI: that an organiser is told so before they pass it on, and
 * that the link is not quietly left anywhere it outlives the conversation.
 */

const dialog = readFileSync(
  join(process.cwd(), 'components/member/sign-in-link-dialog.tsx'),
  'utf8',
);
const members = readFileSync(
  join(process.cwd(), 'app/(app)/(dashboard)/admin/[orgSlug]/members/page.tsx'),
  'utf8',
);

/**
 * Comments say all the right things and change no behaviour.
 *
 * Scanning source for a string has caught this project out three times by
 * matching the paragraph explaining why the thing must not happen.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('warning an organiser what the link is', () => {
  it('says it signs the holder in as that member', () => {
    expect(code(dialog)).toMatch(/can sign in as/i);
  });

  it('says when it stops working', () => {
    expect(code(dialog)).toMatch(/stops working/i);
  });

  it('says the member’s earlier link has been cancelled', () => {
    // Minting replaces the live token, so an organiser helping somebody whose
    // emailed link was merely slow has just broken the slow one.
    expect(code(dialog)).toMatch(/cancelled any earlier one/i);
  });
});

describe('where the link is allowed to go', () => {
  it.each(['localStorage', 'sessionStorage', 'document.cookie'])(
    'never puts it in %s',
    (sink) => {
      expect(code(dialog)).not.toContain(sink);
    },
  );

  it('does not put it in the address bar', () => {
    // A link in the query string survives in history and in any logging the
    // browser or an extension does.
    expect(code(dialog)).not.toMatch(/router\.(push|replace)|history\.(push|replace)State/);
  });
});

describe('when the link is minted', () => {
  it('asks the API only once a dialog is open', () => {
    const body = code(dialog);
    const call = body.indexOf('createSignInLink');
    const effect = body.indexOf('useEffect');

    expect(call).toBeGreaterThan(effect);
    expect(body).toMatch(/if \(!open\) return;/);
  });

  it('is mounted by the page only for a chosen member', () => {
    // Mounting it unconditionally would mint on every render of the roster,
    // and every mint cancels that member's previous link.
    expect(code(members)).toMatch(/\{linkFor && token && currentOrgId && \(/);
  });

  it('is reached from the member menu', () => {
    expect(code(members)).toContain('Give them a sign-in link');
    expect(code(members)).toMatch(/setLinkFor\(openMenu\.member\)/);
  });
});
