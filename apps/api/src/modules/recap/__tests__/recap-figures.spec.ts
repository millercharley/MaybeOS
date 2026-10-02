import { BULK_ARRIVAL, splitArrivals } from '../recap-figures';

/**
 * Telling a co-op moving in apart from a month of people joining (RCP-01).
 *
 * The failure this exists for is specific and was going to happen on a known
 * date: MaybeItsFate imports 364 members, and a spreadsheet with no join-date
 * column gives every one of them today's. The first recap would then tell 364
 * people that 364 people joined last month — a false claim, in the co-op's
 * name, to the whole community at once.
 */

const at = (iso: string) => new Date(iso);

describe('arrivals', () => {
  it('counts ordinary joins as joins', () => {
    const joins = [
      at('2026-09-03T14:02:00Z'),
      at('2026-09-11T09:40:00Z'),
      at('2026-09-26T20:15:00Z'),
    ];

    expect(splitArrivals(joins)).toEqual({ joined: 3, imported: 0 });
  });

  it('counts a roster that arrived in one minute as an import', () => {
    const roster = Array.from({ length: 364 }, () => at('2026-09-01T15:00:30Z'));

    expect(splitArrivals(roster)).toEqual({ joined: 0, imported: 364 });
  });

  it('keeps real joiners in the same month as an import', () => {
    const mixed = [
      ...Array.from({ length: 100 }, () => at('2026-09-01T15:00:00Z')),
      at('2026-09-14T11:00:00Z'),
      at('2026-09-20T17:30:00Z'),
    ];

    expect(splitArrivals(mixed)).toEqual({ joined: 2, imported: 100 });
  });

  it('does not call a busy open evening an import', () => {
    // Twelve people signing up during one event is a good night, not a
    // spreadsheet, and calling it an import would hide the best month a small
    // co-op had all year.
    const evening = Array.from({ length: 12 }, () => at('2026-09-18T19:10:00Z'));

    expect(splitArrivals(evening)).toEqual({ joined: 12, imported: 0 });
    expect(BULK_ARRIVAL).toBeGreaterThan(12);
  });

  it('counts nothing as nothing', () => {
    expect(splitArrivals([])).toEqual({ joined: 0, imported: 0 });
  });
});
