import { bookingWhen } from '@/lib/booking-when';

/**
 * The bug: October 2028 reservations read as October, full stop, in a list
 * whose other rows were all next week — so they looked like reservations that
 * had already happened and were showing up under Upcoming by mistake.
 *
 * Dates are built from local wall time rather than `Z` strings, because the
 * rule is about the year the reader is in. Jest pins the zone to
 * America/New_York (apps/web/jest.config.js).
 */

const at = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString();

const NOW = new Date(2026, 10, 3, 12, 0); // 3 November 2026

describe('the year', () => {
  it('is left off inside the current year, where it is noise', () => {
    const text = bookingWhen(at(2026, 11, 6, 17), at(2026, 11, 6, 22), NOW);

    expect(text).toMatch(/Nov/);
    expect(text).toMatch(/\b6\b/);
    expect(text).not.toContain('2026');
  });

  it('is shown for the October that is two years away — the whole bug', () => {
    const text = bookingWhen(at(2028, 10, 14, 15), at(2028, 10, 14, 17), NOW);

    expect(text).toContain('2028');
  });

  it('is shown for a reservation that really has passed, in a past year', () => {
    // The Past tab shows years of imported history; a 2025 row saying only
    // "14 Oct" is the same sentence with the same ambiguity.
    const text = bookingWhen(at(2025, 10, 14, 15), at(2025, 10, 14, 17), NOW);

    expect(text).toContain('2025');
  });

  it('turns up the moment the reader crosses into the next year', () => {
    const reservation = [at(2026, 12, 30, 19), at(2026, 12, 30, 21)] as const;

    expect(bookingWhen(...reservation, NOW)).not.toContain('2026');
    expect(bookingWhen(...reservation, new Date(2027, 0, 1, 9, 0))).toContain('2026');
  });

  it('decides on the reservation, not on how far away it is', () => {
    // Next week and 51 weeks from now are both this year, so neither carries
    // a year. Nothing here is a distance in days.
    expect(bookingWhen(at(2026, 11, 10, 19), at(2026, 11, 10, 21), NOW)).not.toContain('2026');
    expect(bookingWhen(at(2026, 1, 5, 19), at(2026, 1, 5, 21), NOW)).not.toContain('2026');
  });
});

describe('what else it says', () => {
  it('ends with the time it ends, not another date', () => {
    const text = bookingWhen(at(2026, 11, 6, 17), at(2026, 11, 6, 20, 30), NOW);

    expect(text).toMatch(/8:30/);
    expect(text).not.toMatch(/Nov.*Nov/);
    // Day order is the locale's business; this only cares that it is one day.
  });

  it('names the weekday, so a wrong-looking date can be checked', () => {
    // 14 October 2028 is a Saturday; 14 October 2026 was a Wednesday. The
    // weekday is the other half of what tells those two apart.
    expect(bookingWhen(at(2028, 10, 14, 15), at(2028, 10, 14, 17), NOW)).toContain('Sat');
  });
});
