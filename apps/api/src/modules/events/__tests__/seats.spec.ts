import { admits, placesLine, seatsFor, seatsFrom, seatsTaken } from '../seats';

/**
 * Capacity counts people, not rows (EVT-64).
 *
 * `_count.rsvps` counts rows, and since EVT-47 a row can be a party: a
 * couple is one RSVP with `plusOnes: 1`. So an evening capped at 20 could
 * hold 20 rows worth 34 people and still report itself open — Charley's
 * card, "a full event can still look open".
 *
 * The product already counted people correctly in two places. The door list
 * and the monthly recap both sum `1 + plusOnes`. The one place that did not
 * was the gate deciding who gets in.
 */
describe('how many places an RSVP takes', () => {
  it('is one for somebody coming alone', () => {
    expect(seatsFor(0)).toBe(1);
  });

  it('is the person plus who they bring', () => {
    expect(seatsFor(3)).toBe(4);
  });

  it('treats an absent plus-ones as none', () => {
    expect(seatsFor(null)).toBe(1);
    expect(seatsFor(undefined)).toBe(1);
  });

  it('never lets a negative shrink the party', () => {
    // Nothing should write one, but a party of zero people is not a thing
    // and a gate that can be opened by one is worse.
    expect(seatsFor(-5)).toBe(1);
  });
});

describe('places already taken', () => {
  it('adds the plus-ones to the rows', () => {
    // 20 rows, 14 plus-ones between them: 34 people, not 20.
    expect(seatsFrom(20, 14)).toBe(34);
  });

  it('is the row count when nobody brought anyone', () => {
    expect(seatsFrom(20, 0)).toBe(20);
  });

  it('handles the empty event, where the sum is null', () => {
    // Prisma's `_sum` is null with no matching rows, which would otherwise
    // make this NaN and compare false against every capacity.
    expect(seatsFrom(0, null)).toBe(0);
  });

  it('adds up a list of RSVPs the same way', () => {
    expect(seatsTaken([{ plusOnes: 0 }, { plusOnes: 1 }, { plusOnes: 3 }])).toBe(7);
  });
});

describe('whether a party gets in', () => {
  it('always admits when there is no capacity', () => {
    expect(admits(null, 500, 4, false)).toBe('CONFIRMED');
  });

  it('admits a party that fits exactly', () => {
    expect(admits(20, 16, 4, false)).toBe('CONFIRMED');
  });

  it('refuses a party that would go one over', () => {
    expect(admits(20, 17, 4, false)).toBe('FULL');
  });

  it('counts the plus-ones already confirmed', () => {
    /*
      The first of the two bugs. 10 rows holding 20 people on a 20-place
      evening: the old gate compared 10 >= 20, found room, and let more in.
    */
    expect(admits(20, seatsFrom(10, 10), 1, false)).toBe('FULL');
  });

  it('counts the plus-ones of the booking being made', () => {
    /*
      The second. One place left, a party of four — the old gate asked only
      whether a *row* fitted, so it confirmed them and the room went three
      over on the night.
    */
    expect(admits(20, 19, 4, false)).toBe('FULL');
    expect(admits(20, 19, 1, false)).toBe('CONFIRMED');
  });

  it('waitlists the whole party rather than splitting it', () => {
    // Letting two of four in is not something a door can do.
    expect(admits(20, 19, 4, true)).toBe('WAITLISTED');
  });

  it('waitlists rather than refusing when the co-op keeps a list', () => {
    expect(admits(10, 10, 1, true)).toBe('WAITLISTED');
    expect(admits(10, 10, 1, false)).toBe('FULL');
  });
});

describe('what the capacity line says', () => {
  it('reads in people', () => {
    expect(placesLine(14, 20)).toBe('14 of 20 places taken');
  });

  it('says nothing when the event has no limit (DESIGN §7)', () => {
    expect(placesLine(14, null)).toBeNull();
    expect(placesLine(14, 0)).toBeNull();
  });
});
