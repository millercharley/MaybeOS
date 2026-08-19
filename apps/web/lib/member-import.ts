import { ImportMemberRow } from './api';
import { toRecord } from './csv';

/**
 * Turning somebody else's export into MaybeOS members (MEM-06).
 *
 * The mapping lives here, in the browser, rather than in the API. A co-op
 * leaving Circle, Mighty Networks, Patreon or a spreadsheet a volunteer keeps
 * has a different set of column names each time, and an API that grew a case
 * for each would be maintaining somebody else's schema forever. The API only
 * ever sees MaybeOS's own field names.
 */

export type FieldKey =
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'joinedAt'
  | 'headline'
  | 'location'
  | 'bio'
  | 'tags'
  | 'avatarUrl'
  | 'emailOptIn'
  | 'link';

export interface FieldSpec {
  key: FieldKey;
  label: string;
  hint?: string;
  required?: boolean;
  /** Several columns can feed one field — five social URLs become one list. */
  multiple?: boolean;
  /** Header names, lowercased, that this field recognises on sight. */
  aliases: string[];
}

export const IMPORT_FIELDS: FieldSpec[] = [
  {
    key: 'email',
    label: 'Email',
    hint: 'Required. Identifies the member, and how they will sign in.',
    required: true,
    aliases: ['email', 'email address', 'e-mail', 'primary email'],
  },
  { key: 'firstName', label: 'First name', aliases: ['first name', 'firstname', 'given name'] },
  { key: 'lastName', label: 'Last name', aliases: ['last name', 'lastname', 'surname', 'family name'] },
  {
    key: 'joinedAt',
    label: 'Joined',
    hint: 'When they joined the community — not the date of this import.',
    aliases: ['join date', 'joined', 'joined at', 'member since', 'created at', 'signup date'],
  },
  { key: 'headline', label: 'Headline', aliases: ['headline', 'tagline', 'title'] },
  { key: 'location', label: 'Location', aliases: ['location', 'city', 'place'] },
  { key: 'bio', label: 'Bio', aliases: ['bio', 'about', 'biography', 'description'] },
  {
    key: 'tags',
    label: 'Tags',
    hint: 'Comma-separated in a single column.',
    aliases: ['tags', 'labels', 'groups'],
  },
  {
    key: 'link',
    label: 'Profile links',
    hint: 'Website and social profiles. Map as many columns as you have.',
    multiple: true,
    aliases: [
      'website', 'url', 'personal website',
      'twitter url', 'twitter', 'x url',
      'facebook url', 'facebook',
      'linkedin url', 'linkedin',
      'instagram url', 'instagram',
    ],
  },
  { key: 'avatarUrl', label: 'Avatar', hint: 'Copied into MaybeOS, not linked.', aliases: ['avatar url', 'avatar', 'profile picture', 'photo'] },
  {
    key: 'emailOptIn',
    label: 'Email marketing',
    hint: 'Subscribed / unsubscribed. Left unset when the column says neither.',
    aliases: ['email marketing', 'marketing', 'subscribed', 'newsletter', 'opt in', 'opt-in'],
  },
];

/** Which CSV column, or columns, feeds each MaybeOS field. */
export type Mapping = Record<FieldKey, string[]>;

export const EMPTY_MAPPING: Mapping = {
  email: [], firstName: [], lastName: [], joinedAt: [], headline: [],
  location: [], bio: [], tags: [], avatarUrl: [], emailOptIn: [], link: [],
};

/**
 * A first guess at the mapping, from the header names.
 *
 * Only ever a guess — every field stays changeable, because a column called
 * "Location" might hold a warehouse aisle. A header matched by one field is
 * not offered to another, so "Twitter URL" does not also land in Website.
 */
export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = { ...EMPTY_MAPPING };
  const taken = new Set<string>();

  for (const field of IMPORT_FIELDS) {
    for (const header of headers) {
      if (taken.has(header)) continue;
      if (!field.aliases.includes(header.trim().toLowerCase())) continue;

      mapping[field.key] = [...mapping[field.key], header];
      taken.add(header);
      if (!field.multiple) break;
    }
  }

  return mapping;
}

/** What is wrong with one row, in words an organiser can act on. */
export interface RowIssue {
  line: number;
  email: string;
  reason: string;
}

export interface PreparedImport {
  rows: ImportMemberRow[];
  /** Rows that cannot be imported at all, and why. */
  skipped: RowIssue[];
  /** Rows that will import, with something worth knowing first. */
  warnings: RowIssue[];
}

/**
 * Everything the import will send, plus everything it will not.
 *
 * Computed in full before anything is sent, because MEM-06's whole point is
 * that an organiser reviews the parsed result rather than discovering it
 * afterwards in their member list.
 */
export function prepareImport(
  headers: string[],
  rawRows: string[][],
  mapping: Mapping,
): PreparedImport {
  const rows: ImportMemberRow[] = [];
  const skipped: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const seen = new Set<string>();

  rawRows.forEach((raw, index) => {
    // +2: one for the header line, one because spreadsheets count from 1.
    const line = index + 2;
    const record = toRecord(headers, raw);
    const pick = (key: FieldKey) => (mapping[key][0] ? record[mapping[key][0]] ?? '' : '');

    const email = pick('email').toLowerCase().trim();

    if (!email) {
      skipped.push({ line, email: '', reason: 'No email address' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      skipped.push({ line, email, reason: 'Not a valid email address' });
      return;
    }
    if (seen.has(email)) {
      // The API would treat the second as "already a member" and move on, but
      // saying so here is the difference between a clean import and a number
      // that does not match the file.
      skipped.push({ line, email, reason: 'Duplicate of an earlier row' });
      return;
    }
    seen.add(email);

    const name = [pick('firstName'), pick('lastName')].map((p) => p.trim()).filter(Boolean).join(' ');

    const joinedRaw = pick('joinedAt');
    let joinedAt: string | undefined;
    if (joinedRaw) {
      const parsed = new Date(joinedRaw);
      if (Number.isNaN(parsed.getTime())) {
        warnings.push({ line, email, reason: `Join date "${joinedRaw}" not understood — will import as today` });
      } else {
        joinedAt = parsed.toISOString();
      }
    } else {
      warnings.push({ line, email, reason: 'No join date — will import as today' });
    }

    const links = mapping.link
      .map((header) => (record[header] ?? '').trim())
      .filter((value) => /^https?:\/\//i.test(value));

    const tags = pick('tags')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const avatarUrl = pick('avatarUrl').trim();

    const row: ImportMemberRow = { email };
    if (name) row.name = name;
    if (joinedAt) row.joinedAt = joinedAt;
    if (pick('headline').trim()) row.headline = pick('headline').trim();
    if (pick('location').trim()) row.location = pick('location').trim();
    if (pick('bio').trim()) row.bio = pick('bio').trim();
    if (tags.length) row.tags = tags;
    if (links.length) row.links = links;
    if (/^https?:\/\//i.test(avatarUrl)) row.avatarUrl = avatarUrl;

    const optIn = readOptIn(pick('emailOptIn'));
    if (optIn !== undefined) row.emailOptIn = optIn;

    rows.push(row);
  });

  return { rows, skipped, warnings };
}

/**
 * Read a marketing-consent column without inventing an answer.
 *
 * Anything the column does not clearly say is left undefined — never asked —
 * rather than being rounded to false. A wrong `false` silences somebody who
 * agreed to hear from their co-op; a wrong `true` emails somebody who did
 * not. Only the words that actually mean something are honoured.
 */
export function readOptIn(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (['subscribed', 'true', 'yes', 'y', 'opted in', 'opted-in', '1'].includes(v)) return true;
  if (['unsubscribed', 'false', 'no', 'n', 'opted out', 'opted-out', '0'].includes(v)) return false;
  return undefined;
}

/** Split into request-sized pieces. The API refuses more than 100 at once. */
export function chunk<T>(items: T[], size = 50): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
