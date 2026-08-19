import { guessMapping, prepareImport, readOptIn, chunk, EMPTY_MAPPING, Mapping } from '@/lib/member-import';

/**
 * Mapping somebody else's export onto MaybeOS's fields (MEM-06).
 *
 * The headers used here are the real ones from a Circle audience export, so
 * these tests fail if the auto-detection stops recognising the file the
 * feature was built for.
 */
const CIRCLE_HEADERS = [
  'UID', 'ID', 'First Name', 'Last Name', 'Email', 'Join Date',
  'Active (Signed In Last 30 Days)', 'Tags', 'Location', 'Headline', 'Bio',
  'Profile URL', 'Website', 'Twitter URL', 'Facebook URL', 'LinkedIn URL',
  'Instagram URL', 'No. of Posts', 'No. of Comments', 'No. of Likes Received',
  'Gamification level', 'Avatar URL', 'Last Active', 'Email marketing',
  'Member [y/N]', 'Invitation status', 'Invitation date',
];

describe('guessMapping', () => {
  it('recognises a Circle export without being told', () => {
    const m = guessMapping(CIRCLE_HEADERS);

    expect(m.email).toEqual(['Email']);
    expect(m.firstName).toEqual(['First Name']);
    expect(m.lastName).toEqual(['Last Name']);
    expect(m.joinedAt).toEqual(['Join Date']);
    expect(m.headline).toEqual(['Headline']);
    expect(m.location).toEqual(['Location']);
    expect(m.bio).toEqual(['Bio']);
    expect(m.tags).toEqual(['Tags']);
    expect(m.avatarUrl).toEqual(['Avatar URL']);
    expect(m.emailOptIn).toEqual(['Email marketing']);
  });

  it('gathers every social column into one list of links', () => {
    const m = guessMapping(CIRCLE_HEADERS);

    expect(m.link).toEqual([
      'Website', 'Twitter URL', 'Facebook URL', 'LinkedIn URL', 'Instagram URL',
    ]);
  });

  it('leaves the columns Charley asked to ignore unmapped', () => {
    const m = guessMapping(CIRCLE_HEADERS);
    const mapped = Object.values(m).flat();

    for (const ignored of [
      'UID', 'ID', 'Active (Signed In Last 30 Days)', 'Profile URL',
      'No. of Posts', 'No. of Comments', 'No. of Likes Received',
      'Gamification level', 'Last Active', 'Invitation status',
      'Invitation date', 'Member [y/N]',
    ]) {
      expect(mapped).not.toContain(ignored);
    }
  });

  it('never feeds one column to two fields', () => {
    const mapped = Object.values(guessMapping(CIRCLE_HEADERS)).flat();

    expect(new Set(mapped).size).toBe(mapped.length);
  });
});

describe('prepareImport', () => {
  const headers = ['Email', 'First Name', 'Last Name', 'Join Date', 'Bio', 'Website', 'Twitter URL', 'Email marketing', 'Avatar URL', 'Tags'];
  const mapping: Mapping = {
    ...EMPTY_MAPPING,
    email: ['Email'],
    firstName: ['First Name'],
    lastName: ['Last Name'],
    joinedAt: ['Join Date'],
    bio: ['Bio'],
    link: ['Website', 'Twitter URL'],
    emailOptIn: ['Email marketing'],
    avatarUrl: ['Avatar URL'],
    tags: ['Tags'],
  };

  const row = (over: Partial<Record<string, string>> = {}) =>
    headers.map((h) => over[h] ?? '');

  it('builds one name from two columns', () => {
    const { rows } = prepareImport(headers, [row({ Email: 'a@x.org', 'First Name': 'Maya', 'Last Name': 'Chen' })], mapping);

    expect(rows[0].name).toBe('Maya Chen');
  });

  it('keeps the join date the export recorded', () => {
    const { rows } = prepareImport(headers, [row({ Email: 'a@x.org', 'Join Date': '2023-09-22T18:45:04.000Z' })], mapping);

    expect(rows[0].joinedAt).toBe('2023-09-22T18:45:04.000Z');
  });

  it('warns rather than guessing when a row has no join date', () => {
    const { rows, warnings } = prepareImport(headers, [row({ Email: 'a@x.org' })], mapping);

    expect(rows[0].joinedAt).toBeUndefined();
    expect(warnings[0].reason).toMatch(/no join date/i);
  });

  it('collects the social columns into one list, dropping anything not a link', () => {
    const { rows } = prepareImport(
      headers,
      [row({ Email: 'a@x.org', Website: 'https://example.org', 'Twitter URL': '@handle' })],
      mapping,
    );

    expect(rows[0].links).toEqual(['https://example.org']);
  });

  it('refuses a row with no email, and says which line', () => {
    const { rows, skipped } = prepareImport(headers, [row({ 'First Name': 'Nobody' })], mapping);

    expect(rows).toHaveLength(0);
    expect(skipped[0]).toEqual({ line: 2, email: '', reason: 'No email address' });
  });

  it('refuses an address that is not one', () => {
    const { skipped } = prepareImport(headers, [row({ Email: 'not-an-email' })], mapping);

    expect(skipped[0].reason).toMatch(/not a valid email/i);
  });

  it('catches a duplicate inside the file itself', () => {
    const { rows, skipped } = prepareImport(
      headers,
      [row({ Email: 'a@x.org' }), row({ Email: 'A@X.org' })],
      mapping,
    );

    // Same person, different capitalisation. Reported rather than silently
    // collapsed, so the count matches the file the organiser is looking at.
    expect(rows).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/duplicate/i);
  });

  it('reports the spreadsheet line number, not the array index', () => {
    const { skipped } = prepareImport(headers, [row({ Email: 'a@x.org' }), row({})], mapping);

    expect(skipped[0].line).toBe(3);
  });
});

describe('readOptIn', () => {
  it('reads what the column actually says', () => {
    expect(readOptIn('subscribed')).toBe(true);
    expect(readOptIn('unsubscribed')).toBe(false);
    expect(readOptIn('Yes')).toBe(true);
    expect(readOptIn('no')).toBe(false);
  });

  it('leaves anything else unset rather than rounding it to a refusal', () => {
    // A wrong `false` silences somebody who agreed to hear from their co-op.
    expect(readOptIn('')).toBeUndefined();
    expect(readOptIn('pending')).toBeUndefined();
  });
});

describe('chunk', () => {
  it('splits to fit the API’s 100-row ceiling', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
});
