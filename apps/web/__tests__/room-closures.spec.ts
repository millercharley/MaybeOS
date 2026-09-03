import { closureLabel, dayLabel } from '@/lib/room-closures';
import type { Closure } from '@/lib/api';

/**
 * How a closed period reads (SPC-18).
 *
 * One day or several, all day or part of it — each is a different sentence
 * rather than a template with blanks.
 */
const closure = (over: Partial<Closure>): Closure => ({
  id: 'c1',
  label: null,
  fromDate: '2026-12-25',
  toDate: '2026-12-25',
  startTime: '00:00',
  endTime: '23:59',
  allDay: true,
  ...over,
});

describe('closureLabel', () => {
  it('reads a single all-day closure as one day', () => {
    expect(closureLabel(closure({}))).toBe('25 Dec');
  });

  it('reads a range as a range', () => {
    expect(
      closureLabel(closure({ fromDate: '2026-12-24', toDate: '2027-01-02' })),
    ).toBe('24 Dec – 2 Jan 2027');
  });

  it('does not repeat the day when a range is one day long', () => {
    // The server stores a single day as from and to on the same date, and
    // "25 Dec – 25 Dec" reads as a mistake.
    expect(closureLabel(closure({ fromDate: '2026-12-25', toDate: '2026-12-25' }))).toBe(
      '25 Dec',
    );
  });

  it('names the hours for a part-day closure', () => {
    expect(
      closureLabel(
        closure({ allDay: false, startTime: '12:00', endTime: '13:00' }),
      ),
    ).toBe('25 Dec, 12:00–13:00');
  });

  it('says something rather than nothing when dates are missing', () => {
    expect(closureLabel(closure({ fromDate: null, toDate: null }))).toBe('Unknown dates');
  });
});

describe('dayLabel', () => {
  const thisYear = new Date('2026-06-01T00:00:00Z');

  it('drops the year for the current one', () => {
    expect(dayLabel('2026-12-25', thisYear)).toBe('25 Dec');
  });

  it('keeps the year when it differs', () => {
    // A closure in January is otherwise indistinguishable from one that has
    // already passed.
    expect(dayLabel('2027-01-02', thisYear)).toBe('2 Jan 2027');
  });

  it('has nothing to say about a missing date', () => {
    expect(dayLabel(null, thisYear)).toBeNull();
  });
});
