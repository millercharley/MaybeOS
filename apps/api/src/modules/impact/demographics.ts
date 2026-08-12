/**
 * The demographic profile (IMP-17, PRD §6.4 and §10).
 *
 * Collected once, in a section the member owns — never inside an impact
 * micro-survey. The PRD is emphatic about the framing because the honest
 * reason to ask is not curiosity about members: it is being able to say who
 * the space actually serves, and who it is not reaching.
 *
 * Every field is optional and skippable on its own, and every field offers
 * "prefer not to say" as a real answer rather than an absence — the two mean
 * different things, and only one of them is a signal.
 */

export const PREFER_NOT_TO_SAY = 'prefer_not_to_say';

export interface DemographicField {
  key: string;
  label: string;
  /** Free-text fields have no options; everything else is tap-to-select. */
  options?: string[];
}

/**
 * The PRD's recommended default set. Admin add/remove is a later increment;
 * until then this list is the whole vocabulary, which is deliberate — an
 * open-ended set would let a co-op collect anything and call it a segment.
 */
export const DEMOGRAPHIC_FIELDS: DemographicField[] = [
  {
    key: 'ageBand',
    label: 'Age',
    options: ['under_18', '18_24', '25_34', '35_44', '45_54', '55_64', '65_plus'],
  },
  { key: 'neighborhood', label: 'ZIP or neighbourhood' },
  {
    key: 'householdIncomeBand',
    label: 'Household income',
    options: ['under_25k', '25k_50k', '50k_75k', '75k_100k', '100k_150k', 'over_150k'],
  },
  {
    key: 'raceEthnicity',
    label: 'Race or ethnicity',
    options: [
      'american_indian_or_alaska_native',
      'asian',
      'black_or_african_american',
      'hispanic_or_latino',
      'middle_eastern_or_north_african',
      'native_hawaiian_or_pacific_islander',
      'white',
      'multiracial',
      'self_describe',
    ],
  },
  {
    key: 'gender',
    label: 'Gender',
    options: ['woman', 'man', 'non_binary', 'self_describe'],
  },
  {
    key: 'disabilityStatus',
    label: 'Disability',
    options: ['yes', 'no'],
  },
  { key: 'primaryLanguage', label: 'Primary language' },
  {
    key: 'howHeard',
    label: 'How you heard about us',
    options: [
      'friend_or_member',
      'event',
      'social_media',
      'search',
      'walked_past',
      'partner_organisation',
      'other',
    ],
  },
];

const FIELDS_BY_KEY = new Map(DEMOGRAPHIC_FIELDS.map((f) => [f.key, f]));

/**
 * Keep what the member actually answered, discard the rest.
 *
 * Unknown keys are dropped rather than rejected: this is a profile somebody
 * filled in, not an API contract to police, and losing the whole submission
 * because one key was stale would be the wrong trade. Empty strings are
 * treated as "skipped" and removed, so clearing a field works.
 */
export function sanitizeDemographics(
  input: Record<string, unknown>,
): Record<string, string> {
  const clean: Record<string, string> = {};

  for (const [key, raw] of Object.entries(input ?? {})) {
    const field = FIELDS_BY_KEY.get(key);
    if (!field) continue;

    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;

    if (value === PREFER_NOT_TO_SAY) {
      clean[key] = PREFER_NOT_TO_SAY;
      continue;
    }

    // Free-text fields (neighbourhood, language, and the self-describe
    // answers) are stored as written, bounded so a profile cannot become a
    // dumping ground.
    if (!field.options) {
      clean[key] = value.slice(0, 120);
      continue;
    }

    if (field.options.includes(value)) {
      clean[key] = value;
    }
  }

  return clean;
}

/**
 * Small-cell suppression (PRD §6.4). Mandatory and non-overridable.
 *
 * "In a 300-member community, a segment of three is a person, not a
 * statistic." Any segment below the threshold is reported as too small rather
 * than reported quietly, because a hidden suppression looks like a zero.
 *
 * Note the second rule: suppressed counts are folded into `suppressed` rather
 * than dropped, so the total still adds up — otherwise the difference between
 * the published segments and the response count reconstructs exactly the
 * number that was being protected.
 */
export const SUPPRESSION_THRESHOLD = 5;

export interface SuppressedDistribution {
  /** Segments large enough to report, as value → count. */
  reported: Record<string, number>;
  /** How many people fell into segments too small to name. */
  suppressed: number;
  /** True when nothing at all could be reported. */
  allSuppressed: boolean;
}

export function suppressSmallCells(
  counts: Record<string, number>,
  threshold = SUPPRESSION_THRESHOLD,
): SuppressedDistribution {
  const reported: Record<string, number> = {};
  let suppressed = 0;

  for (const [value, count] of Object.entries(counts)) {
    if (count >= threshold) {
      reported[value] = count;
    } else {
      suppressed += count;
    }
  }

  return {
    reported,
    suppressed,
    allSuppressed: Object.keys(reported).length === 0,
  };
}
