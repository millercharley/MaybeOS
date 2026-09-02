/**
 * Wall-clock time in a co-op's own timezone.
 *
 * Availability rules are `"09:00"` strings and they mean nine in the morning
 * where the room physically is. Everything else in the system is a UTC
 * instant. `validateAvailability` used to bridge the two with `getUTCHours()`,
 * which silently made "09:00–17:00" mean 5am–1pm in New York — the default
 * timezone for every organisation. No rule had ever been written when this was
 * found, so the semantics are being fixed rather than the data.
 *
 * `Intl` rather than a date library: the zone database ships with Node, and
 * this is the whole of what we need from it.
 */

/** How far ahead of UTC `timeZone` is at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value);

  const asIfUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    // Some locales render midnight as 24; both mean the same instant.
    at('hour') % 24,
    at('minute'),
    at('second'),
  );

  return asIfUtc - instant.getTime();
}

/** Where an instant falls on the clock and calendar in `timeZone`. */
export function zonedParts(
  instant: Date,
  timeZone: string,
): { date: string; dayOfWeek: number; minutes: number } {
  const shifted = new Date(instant.getTime() + offsetMs(instant, timeZone));

  return {
    date: shifted.toISOString().slice(0, 10),
    dayOfWeek: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/**
 * The instant at which it is `minutes` past midnight on `date` in `timeZone`.
 *
 * Two passes, because the offset depends on the answer: the first guess uses
 * the offset at the naive time, the second uses the offset at the guess. That
 * matters twice a year — without it, every slot on the morning the clocks go
 * forward is an hour out.
 */
export function instantAt(date: string, minutes: number, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const naive = Date.UTC(year, month - 1, day) + minutes * 60_000;

  const firstGuess = new Date(naive - offsetMs(new Date(naive), timeZone));
  return new Date(naive - offsetMs(firstGuess, timeZone));
}

/** Every date in `month` ("YYYY-MM"), as "YYYY-MM-DD". */
export function datesInMonth(month: string): string[] {
  const [year, monthIndex] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();

  return Array.from(
    { length: days },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  );
}
