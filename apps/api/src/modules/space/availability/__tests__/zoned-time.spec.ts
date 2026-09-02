import { datesInMonth, instantAt, zonedParts } from '../zoned-time';

/**
 * "09:00" means nine in the morning where the room is.
 *
 * `validateAvailability` compared rule strings against `getUTCHours()`, so
 * 09:00–17:00 meant 5am–1pm for every organisation on the default
 * `America/New_York`. No rule had been written anywhere when this was found,
 * so the semantics could be fixed rather than the data.
 */
describe('zoned-time', () => {
  const NY = 'America/New_York';

  it("reads an instant as the wall clock in the room's zone", () => {
    // 14:00 UTC is 10am Eastern in September.
    expect(zonedParts(new Date('2026-09-02T14:00:00Z'), NY)).toEqual({
      date: '2026-09-02',
      dayOfWeek: 3,
      minutes: 10 * 60,
    });
  });

  it('puts a late-evening booking on the right local day', () => {
    // 01:00 UTC Thursday is 9pm Wednesday in New York. Under the old UTC
    // comparison this booking was tested against Thursday's opening hours.
    expect(zonedParts(new Date('2026-09-03T01:00:00Z'), NY)).toMatchObject({
      date: '2026-09-02',
      dayOfWeek: 3,
      minutes: 21 * 60,
    });
  });

  it('turns a local wall-clock time into the right instant', () => {
    expect(instantAt('2026-09-02', 9 * 60, NY).toISOString()).toBe(
      '2026-09-02T13:00:00.000Z',
    );
  });

  it('holds through the switch off daylight time', () => {
    // 2026-11-01: clocks go back at 2am, so 9am Eastern is UTC-5 that day and
    // UTC-4 the day before. One offset for the whole year is how every slot on
    // that morning ends up an hour out.
    expect(instantAt('2026-11-01', 9 * 60, NY).toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
    expect(instantAt('2026-10-31', 9 * 60, NY).toISOString()).toBe(
      '2026-10-31T13:00:00.000Z',
    );
  });

  it('holds through the switch onto daylight time', () => {
    // 2026-03-08: clocks go forward at 2am.
    expect(instantAt('2026-03-08', 9 * 60, NY).toISOString()).toBe(
      '2026-03-08T13:00:00.000Z',
    );
    expect(instantAt('2026-03-07', 9 * 60, NY).toISOString()).toBe(
      '2026-03-07T14:00:00.000Z',
    );
  });

  it('round-trips a local time through both directions', () => {
    const instant = instantAt('2026-06-15', 13 * 60 + 30, NY);

    expect(zonedParts(instant, NY)).toMatchObject({
      date: '2026-06-15',
      minutes: 13 * 60 + 30,
    });
  });

  it('works for a co-op that is not in New York', () => {
    expect(instantAt('2026-09-02', 9 * 60, 'Europe/London').toISOString()).toBe(
      '2026-09-02T08:00:00.000Z',
    );
    // Half-hour offsets are the case a naive hours-only conversion gets wrong.
    expect(instantAt('2026-09-02', 9 * 60, 'Asia/Kolkata').toISOString()).toBe(
      '2026-09-02T03:30:00.000Z',
    );
  });

  it('counts the days in a month, February included', () => {
    expect(datesInMonth('2026-09')).toHaveLength(30);
    expect(datesInMonth('2026-02')).toHaveLength(28);
    expect(datesInMonth('2028-02')).toHaveLength(29);
    expect(datesInMonth('2026-09')[0]).toBe('2026-09-01');
  });
});
