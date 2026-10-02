import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * My Bookings, after a calendar import (SPC-23, SPC-24).
 *
 * MaybeItsFate's import produced 3,017 room reservations and filed every one
 * under c@maybeitsfate.com, because that is the account the co-op's
 * automation keeps its calendar with. Charley opened his member dashboard to
 * the entire booking history of eight rooms, presented as his.
 *
 * Three things came out of that: a hold the co-op made is not somebody's
 * booking, a booking list is about what is ahead, and the thing a member
 * most often wants from a past booking is the same room again.
 */

const WEB = join(__dirname, '..');
const page = readFileSync(
  join(WEB, 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'bookings', 'page.tsx'),
  'utf8',
);
const dashboard = readFileSync(
  join(WEB, 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'page.tsx'),
  'utf8',
);
const api = readFileSync(join(WEB, 'lib', 'api.ts'), 'utf8');

describe('what the list opens on', () => {
  it('asks the server for upcoming by default', () => {
    expect(api).toMatch(/when: 'upcoming' \| 'past' = 'upcoming'/);
    expect(api).toMatch(/my-bookings\?when=/);
  });

  it('starts on upcoming', () => {
    expect(page).toMatch(/useState<'upcoming' \| 'past'>\('upcoming'\)/);
  });

  it('offers the past as a second look', () => {
    expect(page).toMatch(/\['upcoming', 'past'\]/);
  });

  it('reloads when the choice changes', () => {
    expect(page).toMatch(/\}, \[token, orgId, showing\]\);/);
  });

  it('says something different when there is no past than when there is no future', () => {
    expect(page).toMatch(/your past bookings will appear/);
    expect(page).toMatch(/Nothing booked yet/);
  });
});

describe('what can be done to a booking', () => {
  it('offers Book again on any of them, past included', () => {
    // The point of looking at a past booking is usually to make another one.
    expect(page).toMatch(/Book again/);
    expect(page).toMatch(/startClone\(b\)/);
  });

  it('only offers reschedule and cancel on something that has not happened', () => {
    expect(page).toMatch(/showing === 'upcoming' && \(/);
  });

  it('proposes a date that has not already passed', () => {
    // Cloning last March's booking must not propose last April's.
    expect(page).toMatch(/while \(nextStart\.getTime\(\) < Date\.now\(\)\)/);
  });

  it('keeps the original length rather than guessing one', () => {
    expect(page).toMatch(/end\.getTime\(\) - start\.getTime\(\)/);
  });

  it('returns to upcoming after booking, where the new one is', () => {
    expect(page).toMatch(/setShowing\('upcoming'\)/);
  });
});

describe('the dashboard panel goes somewhere', () => {
  it('links each row to the bookings page', () => {
    // It was a dead list: dates with no way to reach what they described.
    expect(dashboard).toMatch(/href=\{`\/member\/\$\{orgSlug\}\/bookings`\}/);
  });

  it('offers a way to manage them all', () => {
    expect(dashboard).toMatch(/Manage your bookings/);
  });
});
