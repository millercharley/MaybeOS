import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  addressesIn,
  isAllowedDomain,
  sourceFiles,
  DOCUMENTATION_DOMAINS,
  FIXTURE_PLACEHOLDERS,
  OUR_DOMAINS,
} from '../testing/address-scan';

/**
 * No real member's email address in the source (OPS-38).
 *
 * Twice an address was committed in a comment explaining the member's own
 * bug, and twice a hand sweep failed to find it among six hundred others. The
 * rule and the reasoning are in `address-scan.ts`; this is the sweep.
 */
const REPO = join(__dirname, '..', '..', '..', '..', '..');

/*
  This file is the one exemption, and it needs to be: its fixtures are
  addresses at the providers the rule refuses, which is what they are for.
  `Member@bellsouth.net` below is the shape of the address behind AUTH-07.

  Writing them as `['Member@', 'bellsouth.net'].join('')` would pass without
  an exemption, but teaching a file to hide addresses from a scan — this file
  in particular — is a worse habit than naming the exception out loud.
*/
const EXEMPT = ['apps/api/src/common/__tests__/no-real-addresses.spec.ts'];

describe('which domains a fixture may use', () => {
  it('allows the ones reserved for documentation, and their subdomains', () => {
    for (const domain of DOCUMENTATION_DOMAINS) {
      expect(isAllowedDomain(domain)).toBe(true);
      expect(isAllowedDomain(`db.${domain}`)).toBe(true);
    }
  });

  it('allows the reserved suffixes, which can never be delivered to', () => {
    for (const domain of ['forum.example', 'anything.test', 'nope.invalid', 'dev.localhost']) {
      expect(isAllowedDomain(domain)).toBe(true);
    }
  });

  it('allows our own, where a member never has a mailbox', () => {
    for (const domain of OUR_DOMAINS) expect(isAllowedDomain(domain)).toBe(true);
  });

  it('allows the placeholders somebody has looked at, and exactly those', () => {
    for (const domain of FIXTURE_PLACEHOLDERS) expect(isAllowedDomain(domain)).toBe(true);

    // Listed, not matched by shape: a domain is not safe for being short.
    expect(isAllowedDomain('e.com')).toBe(false);
    expect(isAllowedDomain('sub.b.com')).toBe(false);
  });

  it('allows a Google Calendar id, which is not a mailbox', () => {
    expect(isAllowedDomain('group.calendar.google.com')).toBe(true);

    // The provider itself is still refused.
    expect(isAllowedDomain('google.com')).toBe(false);
  });

  it('refuses the providers a member actually uses', () => {
    for (const domain of [
      'gmail.com',
      'outlook.com',
      'yahoo.com',
      'hotmail.com',
      'icloud.com',
      'aol.com',
      'bellsouth.net',
      'comcast.net',
      'proton.me',
    ]) {
      expect(isAllowedDomain(domain)).toBe(false);
    }
  });

  it('refuses a domain nobody has ruled on', () => {
    // Which is the whole point of an allowlist: a provider this file has
    // never heard of fails, rather than slipping through until somebody
    // remembers to ban it.
    expect(isAllowedDomain('some-isp-launched-last-tuesday.co.uk')).toBe(false);

    // And no near miss gets in on a substring.
    expect(isAllowedDomain('notexample.com')).toBe(false);
    expect(isAllowedDomain('example.com.ru')).toBe(false);
  });

  it('does not care about case', () => {
    expect(isAllowedDomain('Example.COM')).toBe(true);
    expect(isAllowedDomain('Outlook.com')).toBe(false);
  });
});

describe('finding the addresses in a file', () => {
  it('reads the ones in a line comment, which is where both leaks were', () => {
    const found = addressesIn('// typed Member@bellsouth.net with a capital\nconst x = 1;');

    expect(found).toHaveLength(1);
    expect(found[0].address).toBe('Member@bellsouth.net');
    expect(found[0].domain).toBe('bellsouth.net');
    expect(isAllowedDomain(found[0].domain)).toBe(false);
  });

  it('reads the ones in a block comment', () => {
    const found = addressesIn('/**\n * so `A.B@gmail.com` and `a.b@gmail.com`\n */');

    expect(found.map((f) => f.address)).toEqual(['A.B@gmail.com', 'a.b@gmail.com']);
    expect(found.map((f) => f.line)).toEqual([2, 2]);
  });

  it('reads the ones in code', () => {
    expect(addressesIn("expect(to).toBe('ruth@example.net');")[0].address).toBe('ruth@example.net');
  });

  it('says which line, so a failure is somewhere to go', () => {
    expect(addressesIn('one\ntwo\nthree@example.com\n')[0].line).toBe(3);
  });

  it('keeps the file it was given, for the same reason', () => {
    expect(addressesIn('a@example.com', 'some/file.ts')[0].file).toBe('some/file.ts');
  });

  it('does not mistake an import for an address', () => {
    const source = "import type { Foo } from '@types/node';\nimport '@/lib/x';";

    expect(addressesIn(source)).toEqual([]);
  });
});

describe('the source tree', () => {
  const files = [
    ...sourceFiles(join(REPO, 'apps', 'api')),
    ...sourceFiles(join(REPO, 'apps', 'web')),
  ];
  const found = files.flatMap((file) =>
    addressesIn(readFileSync(file, 'utf8'), relative(REPO, file)),
  );

  /*
    A scan scoped to nothing passes forever, which is how the SEC-10 wildcard
    rule spent months guarding less than it looked like it did (OPS-40). So
    prove there is something here before trusting the silence.
  */
  it('is looking where the source actually is', () => {
    expect(readFileSync(join(REPO, 'package.json'), 'utf8')).toContain('"workspaces"');
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(join(REPO, 'apps', 'api', 'src', 'common', 'email-address.ts'));
  });

  it('has the addresses this is about in it', () => {
    expect(found.length).toBeGreaterThan(100);
    expect(found.some((f) => f.file.endsWith('email-address.ts'))).toBe(true);
  });

  it('exempts this file and nothing else', () => {
    expect(EXEMPT).toEqual([relative(REPO, __filename)]);
  });

  it('holds no address a real person could read', () => {
    const offenders = found
      .filter((f) => !EXEMPT.includes(f.file))
      .filter((f) => !isAllowedDomain(f.domain))
      .map((f) => `${f.file}:${f.line}  ${f.address}`);

    expect(offenders).toEqual([]);
  });
});
