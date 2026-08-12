import {
  DEMOGRAPHIC_FIELDS,
  PREFER_NOT_TO_SAY,
  SUPPRESSION_THRESHOLD,
  sanitizeDemographics,
  suppressSmallCells,
} from '../demographics';

/**
 * The demographic profile and its suppression rule (IMP-17, PRD §6.4).
 *
 * Suppression is the part that must never be negotiable: "in a 300-member
 * community, a segment of three is a person, not a statistic." The PRD makes
 * it mandatory and non-overridable by any role including owner, which means
 * it belongs in the aggregation itself rather than in a display option.
 */
describe('demographics', () => {
  describe('what gets stored', () => {
    it('keeps a valid option', () => {
      expect(sanitizeDemographics({ ageBand: '35_44' })).toEqual({ ageBand: '35_44' });
    });

    it('keeps "prefer not to say" as an answer in its own right', () => {
      // Distinct from skipping: one is a decision, the other is silence, and
      // the summary counts them separately.
      expect(sanitizeDemographics({ gender: PREFER_NOT_TO_SAY })).toEqual({
        gender: PREFER_NOT_TO_SAY,
      });
    });

    it('treats an empty value as skipped, so a field can be cleared', () => {
      expect(sanitizeDemographics({ ageBand: '' })).toEqual({});
      expect(sanitizeDemographics({ neighborhood: '   ' })).toEqual({});
    });

    it('drops an option that is not on the list', () => {
      expect(sanitizeDemographics({ ageBand: 'whatever' })).toEqual({});
    });

    it('drops unknown keys without losing the rest of the profile', () => {
      // A stale key should not cost somebody the form they just filled in.
      expect(
        sanitizeDemographics({ notAField: 'x', ageBand: '25_34' }),
      ).toEqual({ ageBand: '25_34' });
    });

    it('accepts free text where there are no options, bounded', () => {
      const long = 'a'.repeat(400);
      const result = sanitizeDemographics({ neighborhood: long });
      expect(result.neighborhood).toHaveLength(120);
    });

    it('ignores a non-string value rather than storing it', () => {
      expect(sanitizeDemographics({ ageBand: 42 as unknown as string })).toEqual({});
    });

    it('covers the eight fields the PRD names', () => {
      expect(DEMOGRAPHIC_FIELDS.map((f) => f.key)).toEqual([
        'ageBand',
        'neighborhood',
        'householdIncomeBand',
        'raceEthnicity',
        'gender',
        'disabilityStatus',
        'primaryLanguage',
        'howHeard',
      ]);
    });
  });

  describe('small-cell suppression', () => {
    it('reports a segment at the threshold', () => {
      const result = suppressSmallCells({ woman: SUPPRESSION_THRESHOLD });

      expect(result.reported).toEqual({ woman: 5 });
      expect(result.suppressed).toBe(0);
    });

    it('suppresses a segment one below it', () => {
      const result = suppressSmallCells({ woman: 4 });

      expect(result.reported).toEqual({});
      expect(result.allSuppressed).toBe(true);
    });

    it('folds suppressed counts into a total rather than dropping them', () => {
      // If the small segments simply vanished, subtracting the reported
      // figures from the response count would reconstruct exactly the number
      // being protected.
      const result = suppressSmallCells({ woman: 12, man: 9, non_binary: 3 });

      expect(result.reported).toEqual({ woman: 12, man: 9 });
      expect(result.suppressed).toBe(3);
      expect(
        Object.values(result.reported).reduce((n, c) => n + c, 0) + result.suppressed,
      ).toBe(24);
    });

    it('suppresses everything when every segment is small', () => {
      const result = suppressSmallCells({ a: 1, b: 2, c: 1 });

      expect(result.allSuppressed).toBe(true);
      expect(result.suppressed).toBe(4);
    });

    it('holds the threshold at five, the number the PRD fixes', () => {
      expect(SUPPRESSION_THRESHOLD).toBe(5);
    });
  });
});
