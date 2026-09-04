import { happeningToday } from '@/lib/event-list';

/**
 * The line at the top of a member's dashboard (DSH-01).
 *
 * Every case here is one where the obvious implementation says something
 * untrue: a meeting that finished this morning, an event that is "tomorrow"
 * only because the reader is in California, one that is running right now but
 * began yesterday.
 */
const NY = 'America/New_York';

const at = (start: string, end: string, id = start) => ({ id, startTime: start, endTime: end });

describe('what is on at the co-op today', () => {
  // 2026-09-04 14:00 in New York (EDT, UTC-4).
  const now = new Date('2026-09-04T18:00:00Z');

  it('lists what is still to come today', () => {
    const events = [
      at('2026-09-04T23:00:00Z', '2026-09-05T01:00:00Z', 'tonight'), // 7pm NY
      at('2026-09-04T21:00:00Z', '2026-09-04T22:00:00Z', 'this-afternoon'), // 5pm NY
    ];
    expect(happeningToday(events, NY, now).map((e) => e.id)).toEqual([
      'this-afternoon',
      'tonight',
    ]);
  });

  it('drops what already finished', () => {
    // 9am–10am New York. Still "today", but at 2pm it is not what is going on.
    const events = [at('2026-09-04T13:00:00Z', '2026-09-04T14:00:00Z', 'this-morning')];
    expect(happeningToday(events, NY, now)).toEqual([]);
  });

  it('keeps something that is running right now', () => {
    const events = [at('2026-09-04T17:00:00Z', '2026-09-04T19:00:00Z', 'underway')];
    expect(happeningToday(events, NY, now).map((e) => e.id)).toEqual(['underway']);
  });

  it('keeps a late event that began yesterday and has not ended', () => {
    // Started 10pm on the 3rd, runs to 1am on the 4th. Its start date reads as
    // yesterday, but it is the thing that is happening.
    const overnight = at('2026-09-04T02:00:00Z', '2026-09-04T05:00:00Z', 'overnight');
    const early = new Date('2026-09-04T03:00:00Z'); // 11pm on the 3rd, NY
    expect(happeningToday([overnight], NY, early).map((e) => e.id)).toEqual(['overnight']);
  });

  it('uses the co-op’s day, not the reader’s', () => {
    // 8pm New York on the 4th is 5pm in Los Angeles on the 4th — same day. But
    // an 11pm New York event on the 4th is 8pm on the 4th in LA, and a naive
    // UTC date would call it the 5th.
    const lateTonight = at('2026-09-05T03:00:00Z', '2026-09-05T04:00:00Z', 'late');
    expect(happeningToday([lateTonight], NY, now).map((e) => e.id)).toEqual(['late']);
  });

  it('says nothing when nothing is on', () => {
    const nextWeek = at('2026-09-11T23:00:00Z', '2026-09-12T01:00:00Z', 'next-week');
    expect(happeningToday([nextWeek], NY, now)).toEqual([]);
  });
});
