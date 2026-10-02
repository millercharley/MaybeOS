import { isCalendarItself, personFor } from '../past-host';

/**
 * A calendar is not a person (CAL-07).
 *
 * MaybeItsFate's first complete import produced 777 events "hosted by
 * MaybeItsFate Main Events" — every single one, with no member matched to
 * any of them. Google names the *calendar* as the organiser of anything
 * created directly on a shared one, and the importer took it at its word.
 *
 * Worse than saying nothing: it looks like an answer, so nobody checks it.
 */

const CAL = 'maybeitsfate.com_abc123@group.calendar.google.com';

describe('telling a calendar from a person', () => {
  it('recognises the calendar being read', () => {
    expect(isCalendarItself(CAL, CAL)).toBe(true);
    expect(isCalendarItself('  MaybeItsFate.com_ABC123@group.calendar.google.com ', CAL)).toBe(true);
  });

  it('recognises any Google-generated calendar address', () => {
    // A room's calendar names itself too, and it is not the calendar being
    // read when the entry came from somewhere else.
    expect(isCalendarItself('something-else@group.calendar.google.com', CAL)).toBe(true);
    expect(isCalendarItself('x@group.v.calendar.google.com', CAL)).toBe(true);
  });

  it('leaves an ordinary address alone', () => {
    expect(isCalendarItself('sam@example.com', CAL)).toBe(false);
    expect(isCalendarItself('info@maybeitsfate.com', CAL)).toBe(false);
  });

  it('is not confused by nothing', () => {
    expect(isCalendarItself(null, CAL)).toBe(false);
    expect(isCalendarItself('', CAL)).toBe(false);
  });
});

describe('who ran it', () => {
  const entry = (over: Partial<Parameters<typeof personFor>[0]> = {}) => ({
    organiserEmail: 'sam@example.com',
    organiserName: 'Sam Mullooly',
    creatorEmail: 'dee@example.com',
    creatorName: 'Dee Carter',
    ...over,
  });

  it('is the organiser when the organiser is a person', () => {
    expect(personFor(entry(), CAL)).toEqual({ email: 'sam@example.com', name: 'Sam Mullooly' });
  });

  it('is the creator when the calendar organised it', () => {
    // The common case on a shared calendar, and the one that produced 777
    // events hosted by a calendar. The creator is the member who typed it in.
    expect(personFor(entry({ organiserEmail: CAL, organiserName: 'MaybeItsFate Main Events' }), CAL)).toEqual(
      { email: 'dee@example.com', name: 'Dee Carter' },
    );
  });

  it('is nobody when both are the calendar', () => {
    // Honest: a co-op's own calendar entry often has no host, and "hosted by
    // the calendar" is not a better answer than none.
    expect(
      personFor(
        entry({
          organiserEmail: CAL,
          organiserName: 'MaybeItsFate Main Events',
          creatorEmail: CAL,
          creatorName: 'MaybeItsFate Main Events',
        }),
        CAL,
      ),
    ).toEqual({ email: null, name: null });
  });

  it('is nobody when Google said nothing', () => {
    expect(
      personFor(
        { organiserEmail: null, organiserName: null, creatorEmail: null, creatorName: null },
        CAL,
      ),
    ).toEqual({ email: null, name: null });
  });

  it('falls back to the creator when there is no organiser at all', () => {
    expect(personFor(entry({ organiserEmail: null, organiserName: null }), CAL)).toEqual({
      email: 'dee@example.com',
      name: 'Dee Carter',
    });
  });
});
