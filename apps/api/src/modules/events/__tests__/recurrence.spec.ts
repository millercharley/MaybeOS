import { describeRecurrence, MAX_OCCURRENCES, occurrencesOf } from '../recurrence';

/**
 * Repeating an event (EVT-37).
 *
 * Charley: model it after Google Calendar — daily, weekly on chosen days,
 * monthly, yearly, with an interval, ending never, on a date, or after a
 * count.
 *
 * Materialised rather than computed, unlike the service duties (SRV-01),
 * because an event carries RSVPs, tickets, a picture and a room reservation
 * that has to be free on that specific date. A rule cannot hold an RSVP.
 *
 * Louisville is UTC-4 in summer and UTC-5 in winter, which is the case worth
 * pinning: a weekly 7pm event must stay 7pm across the November change.
 */

const ZONE = 'America/Kentucky/Louisville';
const local = (at: Date) =>
  at.toLocaleString('en-GB', { timeZone: ZONE, dateStyle: 'short', timeStyle: 'short' });

describe('daily', () => {
  it('runs from the first, every day', () => {
    const out = occurrencesOf(new Date('2026-10-05T23:00:00Z'), { frequency: 'DAILY', count: 3 }, ZONE);

    expect(out).toHaveLength(3);
    expect(out.map(local)).toEqual(['05/10/2026, 19:00', '06/10/2026, 19:00', '07/10/2026, 19:00']);
  });

  it('counts the interval in days', () => {
    const out = occurrencesOf(
      new Date('2026-10-05T23:00:00Z'),
      { frequency: 'DAILY', interval: 3, count: 3 },
      ZONE,
    );

    expect(out.map(local)).toEqual(['05/10/2026, 19:00', '08/10/2026, 19:00', '11/10/2026, 19:00']);
  });
});

describe('weekly', () => {
  it('repeats on the day the first one falls on', () => {
    // What Google does when you pick "weekly" and nothing else.
    const out = occurrencesOf(new Date('2026-10-06T23:00:00Z'), { frequency: 'WEEKLY', count: 3 }, ZONE);

    expect(out.map(local)).toEqual(['06/10/2026, 19:00', '13/10/2026, 19:00', '20/10/2026, 19:00']);
  });

  it('stays at the same clock time across a change of offset', () => {
    // Louisville goes to UTC-5 on 1 November 2026. Stepping forward in
    // milliseconds would make this 6pm from then on.
    const out = occurrencesOf(
      new Date('2026-10-27T23:00:00Z'),
      { frequency: 'WEEKLY', count: 3 },
      ZONE,
    );

    expect(out.map(local)).toEqual(['27/10/2026, 19:00', '03/11/2026, 19:00', '10/11/2026, 19:00']);
  });

  it('takes several days a week, in calendar order', () => {
    // Tuesday and Thursday, starting on the Tuesday.
    const out = occurrencesOf(
      new Date('2026-10-06T23:00:00Z'),
      { frequency: 'WEEKLY', weekdays: [2, 4], count: 4 },
      ZONE,
    );

    expect(out.map(local)).toEqual([
      '06/10/2026, 19:00',
      '08/10/2026, 19:00',
      '13/10/2026, 19:00',
      '15/10/2026, 19:00',
    ]);
  });

  it('never goes back before the first occurrence', () => {
    // Starting on a Thursday and repeating Tuesdays and Thursdays must not
    // produce the Tuesday two days earlier.
    const out = occurrencesOf(
      new Date('2026-10-08T23:00:00Z'),
      { frequency: 'WEEKLY', weekdays: [2, 4], count: 3 },
      ZONE,
    );

    expect(out.map(local)).toEqual(['08/10/2026, 19:00', '13/10/2026, 19:00', '15/10/2026, 19:00']);
  });

  it('counts the interval in weeks, not in chosen days', () => {
    const out = occurrencesOf(
      new Date('2026-10-06T23:00:00Z'),
      { frequency: 'WEEKLY', weekdays: [2], interval: 2, count: 3 },
      ZONE,
    );

    expect(out.map(local)).toEqual(['06/10/2026, 19:00', '20/10/2026, 19:00', '03/11/2026, 19:00']);
  });
});

describe('monthly', () => {
  it('keeps the day of the month', () => {
    const out = occurrencesOf(new Date('2026-10-15T23:00:00Z'), { frequency: 'MONTHLY', count: 3 }, ZONE);

    expect(out.map(local)).toEqual(['15/10/2026, 19:00', '15/11/2026, 19:00', '15/12/2026, 19:00']);
  });

  it('skips a month that has no such day, rather than sliding it', () => {
    // The 31st in a 30-day month becomes the 1st if you slide it, which puts
    // it in a month the organiser did not choose.
    const out = occurrencesOf(new Date('2026-01-31T19:00:00Z'), { frequency: 'MONTHLY', count: 3 }, ZONE);

    expect(out.map((d) => local(d).slice(0, 10))).toEqual(['31/01/2026', '31/03/2026', '31/05/2026']);
  });
});

describe('yearly', () => {
  it('keeps the date', () => {
    const out = occurrencesOf(new Date('2026-10-05T23:00:00Z'), { frequency: 'YEARLY', count: 2 }, ZONE);

    expect(out.map((d) => local(d).slice(0, 10))).toEqual(['05/10/2026', '05/10/2027']);
  });

  it('skips a year with no 29 February', () => {
    const out = occurrencesOf(new Date('2028-02-29T19:00:00Z'), { frequency: 'YEARLY', count: 2 }, ZONE);

    expect(out.map((d) => local(d).slice(0, 10))).toEqual(['29/02/2028', '29/02/2032']);
  });
});

describe('when it stops', () => {
  it('stops after a count', () => {
    expect(occurrencesOf(new Date('2026-10-05T23:00:00Z'), { frequency: 'DAILY', count: 5 }, ZONE))
      .toHaveLength(5);
  });

  it('stops on a date, and does not pass it', () => {
    const out = occurrencesOf(
      new Date('2026-10-05T23:00:00Z'),
      { frequency: 'DAILY', until: new Date('2026-10-08T23:00:00Z') },
      ZONE,
    );

    expect(out.map((d) => local(d).slice(0, 10))).toEqual([
      '05/10/2026',
      '06/10/2026',
      '07/10/2026',
      '08/10/2026',
    ]);
  });

  it('stops somewhere, even told to repeat for ever', () => {
    // Google will repeat forever; a row per occurrence cannot. A co-op that
    // wants more extends it rather than planning its 2029 from here.
    const out = occurrencesOf(new Date('2026-10-05T23:00:00Z'), { frequency: 'DAILY' }, ZONE);

    expect(out).toHaveLength(MAX_OCCURRENCES);
  });

  it('always includes the first, whatever else is asked', () => {
    expect(occurrencesOf(new Date('2026-10-05T23:00:00Z'), { frequency: 'DAILY', count: 0 }, ZONE))
      .toHaveLength(1);
  });
});

describe('how a repeat reads back', () => {
  it('says how many and how often', () => {
    expect(describeRecurrence({ frequency: 'WEEKLY' }, 12)).toBe('12 times, every week');
  });

  it('counts the interval', () => {
    expect(describeRecurrence({ frequency: 'WEEKLY', interval: 2 }, 6)).toBe(
      '6 times, every 2 weeks',
    );
  });

  it('names the days', () => {
    expect(describeRecurrence({ frequency: 'WEEKLY', weekdays: [4, 2] }, 8)).toBe(
      '8 times, every week on Tuesday, Thursday',
    );
  });

  it('counts one as one', () => {
    expect(describeRecurrence({ frequency: 'MONTHLY' }, 1)).toBe('1 time, every month');
  });
});
