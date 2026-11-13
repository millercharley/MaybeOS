import { canonicalDoorScriptUrl, isDoorScriptUrl } from '../door-script';

/**
 * Which shape of the web app address MaybeOS keeps (DOR-02).
 *
 * Apps Script hands out the same deployment under three addresses. Paul
 * Mercer, who built the door hardware and the first sheet, on the one a
 * browser gives you: "The first link doesn't work because of the /u/1 in the
 * address. It is specifying a file in another open google account, multiple
 * open accounts are indexed 0,1,2 etc. just remove them from the link and it
 * should work."
 *
 * It is worse than a broken link: `/u/1` means whoever is second in *the
 * reader's* account switcher, so it works for the person who copied it and
 * opens somebody else's account — or nothing — for everyone else.
 */

const ID = 'AKfycbwFsi2kkOCBa5_k3XVBv9XAXeXMJe9c0QQ3aOpACaxyG2KvJHFyX5XFTi22Ce9uldR1lA';
const CANONICAL = `https://script.google.com/macros/s/${ID}/exec`;

describe('the address MaybeOS keeps', () => {
  it('keeps the plain one unchanged', () => {
    expect(canonicalDoorScriptUrl(CANONICAL)).toBe(CANONICAL);
  });

  it('strips the account index a browser adds', () => {
    expect(
      canonicalDoorScriptUrl(`https://script.google.com/macros/u/1/s/${ID}/exec`),
    ).toBe(CANONICAL);
  });

  it('strips any account index, not just the second', () => {
    for (const n of [0, 2, 7]) {
      expect(
        canonicalDoorScriptUrl(`https://script.google.com/macros/u/${n}/s/${ID}/exec`),
      ).toBe(CANONICAL);
    }
  });

  it('unwraps the Workspace-scoped form', () => {
    // It resolves only for somebody signed into that domain, which a member
    // at the door generally is not.
    expect(
      canonicalDoorScriptUrl(
        `https://script.google.com/a/macros/maybeitsfate.com/s/${ID}/exec`,
      ),
    ).toBe(CANONICAL);
  });

  it('unwraps a Workspace form that also carries an account index', () => {
    expect(
      canonicalDoorScriptUrl(
        `https://script.google.com/a/macros/maybeitsfate.com/u/1/s/${ID}/exec`,
      ),
    ).toBe(CANONICAL);
  });

  it('ignores surrounding space, which a paste often brings', () => {
    expect(canonicalDoorScriptUrl(`  ${CANONICAL}\n`)).toBe(CANONICAL);
  });

  it('keeps the deployment id exactly, since it names the deployment', () => {
    // Two deployments of one script differ only here, and sending codes to
    // the wrong one is silent.
    const other = 'AKfycbwKWcSDxk-lFHWB18Upn--nemGbsw5nOXzJxmXnygeFTr-6LxIemFPyIpi3pBoVDBtM4A';
    expect(canonicalDoorScriptUrl(`https://script.google.com/macros/u/1/s/${other}/exec`))
      .toBe(`https://script.google.com/macros/s/${other}/exec`);
  });
});

describe('what it still refuses', () => {
  /*
    MaybeOS posts member emails, names and door codes to this address, so it
    cannot be "any URL": an organiser, or anyone who takes over an
    organiser's session, could otherwise point the sync at their own server
    and collect every code.
  */
  const refused = [
    ['another host entirely', 'https://example.com/macros/s/' + ID + '/exec'],
    ['a lookalike host', 'https://script.google.com.evil.test/macros/s/' + ID + '/exec'],
    ['plain http', `http://script.google.com/macros/s/${ID}/exec`],
    ['the editor rather than the deployment', `https://script.google.com/macros/s/${ID}/edit`],
    ['a development address', `https://script.google.com/macros/s/${ID}/dev`],
    ['no deployment id at all', 'https://script.google.com/macros/s//exec'],
    ['an id too short to be one', 'https://script.google.com/macros/s/AKfycb/exec'],
    ['something trailing the address', `${CANONICAL}?door=side`],
    ['empty', ''],
  ] as const;

  it.each(refused)('refuses %s', (_what, url) => {
    expect(canonicalDoorScriptUrl(url)).toBeNull();
  });

  it('refuses a Workspace form whose domain is not a domain', () => {
    expect(
      canonicalDoorScriptUrl(`https://script.google.com/a/macros/not a domain/s/${ID}/exec`),
    ).toBeNull();
  });
});

describe('agreement with the older check', () => {
  it('produces something the validator accepts', () => {
    // `isDoorScriptUrl` still guards anything that reaches it by another
    // path; the canonical form must satisfy it.
    expect(isDoorScriptUrl(canonicalDoorScriptUrl(CANONICAL) as string)).toBe(true);
    expect(
      isDoorScriptUrl(
        canonicalDoorScriptUrl(`https://script.google.com/macros/u/1/s/${ID}/exec`) as string,
      ),
    ).toBe(true);
  });
});
