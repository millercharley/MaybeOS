import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What's on, for a co-op with nine rooms (SPC-28).
 *
 * Charley: "display a short preview of the reservation with an option to
 * expand for the full details… add a filter to see by selected rooms, with
 * the default being All Rooms."
 *
 * The day printed every description in full, so a room with four bookings and
 * four paragraphs was a page of prose to scroll past before the next room —
 * and MaybeItsFate has eight rooms under one heading each.
 */

const view = readFileSync(
  join(__dirname, '..', 'components', 'rooms', 'day-schedule.tsx'),
  'utf8',
);

describe('a reservation in the day', () => {
  it('shows one line of the description until asked', () => {
    expect(view).toMatch(/expanded\.has\(b\.id\) \? \(/);
    expect(view).toMatch(/truncate text-sm text-gray-600/);
  });

  it('opens and closes', () => {
    expect(view).toMatch(/aria-expanded=\{expanded\.has\(b\.id\)\}/);
    expect(view).toMatch(/> Less/);
    expect(view).toMatch(/> More/);
  });

  it('opens one without opening the rest', () => {
    // A Set keyed by booking, not a single open id.
    expect(view).toMatch(/useState<Set<string>>\(new Set\(\)\)/);
  });

  it('does not offer to expand a reservation with nothing more to show', () => {
    expect(view).toMatch(/\{\(b\.description \|\| b\.categories\.length > 0\) && \(/);
  });

  it('keeps the time, title and host in the preview', () => {
    // Those are what somebody is scanning for; the description is the part
    // that made the page long.
    expect(view).toMatch(/\{time\(b\.startTime\)\} – \{time\(b\.endTime\)\}/);
    expect(view).toMatch(/<MemberName userId=\{b\.user\.id\}/);
  });
});

describe('filtering by room', () => {
  it('defaults to all rooms', () => {
    expect(view).toMatch(/useState<string>\('all'\)/);
  });

  it('offers All rooms first, then each room', () => {
    expect(view).toMatch(/\{ id: 'all', name: 'All rooms' \}, \.\.\.rooms/);
  });

  it('does not offer a filter to a co-op with one room', () => {
    expect(view).toMatch(/rooms\.length > 1 && \(/);
  });

  it('still lists a chosen room that is free all day', () => {
    // "The studio is free all day" is half of what somebody came to find out,
    // and filtering to it must not hide that.
    expect(view).toMatch(/Free all day/);
    expect(view).toMatch(/roomFilter === 'all' \? rooms : rooms\.filter/);
  });
});
