import { RecapFigures } from '../recap-figures';
import { paragraphIsSupported, recapFacts } from '../recap-composer';

/**
 * The paragraph at the top of a monthly recap (RCP-01).
 *
 * This is the only part of the recap a model writes, and it goes out over the
 * co-op's name to its own members. The failure being guarded against is not a
 * crash: it is a confident sentence containing a number nobody can check —
 * "up twelve percent on August" reads exactly like a true statement, and
 * MaybeOS has no way to catch it after the send.
 */

const FIGURES: RecapFigures = {
  monthLabel: 'September 2026',
  periodStart: '2026-09-01T04:00:00.000Z',
  periodEnd: '2026-10-01T04:00:00.000Z',
  members: { total: 62, joined: 4, imported: 0 },
  events: { hosted: 9, checkedIn: 143, eventsWithDoor: 6, expected: 180 },
  money: {
    month: { duesCents: 120000, ticketsCents: 45000, roomsCents: 0, totalCents: 165000 },
    year: { duesCents: 980000, ticketsCents: 220000, roomsCents: 15000, totalCents: 1215000 },
    duesRecordedSince: '2026-01-04T00:00:00.000Z',
  },
  service: { hours: 46.5, members: 11, valueCents: 130200 },
  impact: [{ category: 'belonging', average: 4.1, respondents: 23 }],
};

describe('what the model is allowed to see', () => {
  it('hands over the figures as labelled numbers, not the raw object', () => {
    const facts = recapFacts(FIGURES, true);

    expect(facts).toContainEqual({ label: 'members now', value: '62' });
    expect(facts).toContainEqual({ label: 'events held', value: '9' });
    // Nothing nested, nothing null: a model handed `null` under a money label
    // writes "raised $0 this month" about a co-op that simply does not show
    // money.
    for (const fact of facts) expect(typeof fact.value).toBe('string');
  });

  it('says which attendance number it is, because the two mean different things', () => {
    const facts = recapFacts(FIGURES, true);
    const attendance = facts.find((f) => f.label.includes('checked in'));

    expect(attendance?.value).toBe('143 across 6 of those events');
  });

  it('falls back to intentions only when nobody worked a door', () => {
    const noDoor = { ...FIGURES, events: { ...FIGURES.events, checkedIn: 0, eventsWithDoor: 0 } };
    const facts = recapFacts(noDoor, true);

    expect(facts.find((f) => f.label.includes('checked in'))).toBeUndefined();
    expect(facts).toContainEqual({ label: 'people who said they were coming', value: '180' });
  });

  it('keeps money away from a co-op that does not show it', () => {
    const facts = recapFacts(FIGURES, false);

    expect(facts.some((f) => f.label.includes('money'))).toBe(false);
    expect(facts.some((f) => f.value.includes('$'))).toBe(false);
  });

  it('carries an impact score only with how many people it came from', () => {
    const facts = recapFacts(FIGURES, true);

    expect(facts).toContainEqual({
      label: 'belonging score out of 5',
      value: '4.1 from 23 members',
    });
  });
});

describe('refusing a paragraph that made something up', () => {
  const facts = recapFacts(FIGURES, true);

  it('accepts one built from the figures it was given', () => {
    const honest =
      'September brought 4 new members, bringing the community to 62. Nine events ran, and 143 people came through the door.';

    expect(paragraphIsSupported(honest, facts)).toBe(true);
  });

  it('refuses an invented comparison, which is the whole reason this exists', () => {
    const invented = 'September was the busiest month yet — attendance was up 12% on August.';

    expect(paragraphIsSupported(invented, facts)).toBe(false);
  });

  it('refuses a figure that is merely plausible', () => {
    // 58 is not in the facts. It is exactly the kind of number that survives
    // a human read, because it looks like it could be last month's total.
    expect(paragraphIsSupported('The co-op grew from 58 members to 62.', facts)).toBe(false);
  });

  it('allows a year, which is a date rather than a claim', () => {
    expect(paragraphIsSupported('September 2026 was a full month.', facts)).toBe(true);
  });

  it('allows a figure written with a comma', () => {
    const withCommas = recapFacts(
      { ...FIGURES, members: { total: 1200, joined: 4, imported: 0 } },
      true,
    );

    expect(paragraphIsSupported('There are now 1,200 members.', withCommas)).toBe(true);
  });

  it('accepts a paragraph with no numbers at all', () => {
    expect(paragraphIsSupported('A steady month, with the usual rhythm of gatherings.', facts)).toBe(
      true,
    );
  });
});
