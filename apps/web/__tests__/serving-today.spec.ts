import { readFileSync } from 'fs';
import { join } from 'path';
import { servingToday, myServiceLabel } from '@/lib/service-rota';
import type { DutyClaimStatus } from '@/lib/api';

/**
 * "You're serving today", and the way back to the page that says so (SRV-04).
 *
 * Charley signed up to water the plants, saw it confirmed in Serve, and then
 * found an empty page and no link back to it. Three separate faults: a turn
 * today counted as past, a reminder that lived in a banner that cleared itself,
 * and nothing on the dashboard on the day.
 */
const NY = 'America/New_York';

const turn = (occursAt: string, status: DutyClaimStatus = 'CONFIRMED', id = occursAt) => ({
  id,
  occursAt,
  status,
});

describe('the turns somebody is on today', () => {
  // 2026-10-03 14:00 in New York (EDT, UTC-4).
  const now = new Date('2026-10-03T18:00:00Z');

  it('keeps a turn whose hour has already gone', () => {
    // 9am New York, read at 2pm. This is the exact case that made the page
    // look empty: the turn was still owed, and it was on no list at all.
    expect(servingToday([turn('2026-10-03T13:00:00Z')], NY, now).map((c) => c.id)).toEqual([
      '2026-10-03T13:00:00Z',
    ]);
  });

  it('keeps a turn still to come today', () => {
    expect(servingToday([turn('2026-10-03T22:00:00Z')], NY, now)).toHaveLength(1);
  });

  it('drops a turn already marked done', () => {
    expect(servingToday([turn('2026-10-03T13:00:00Z', 'DONE')], NY, now)).toEqual([]);
  });

  it('drops a turn handed back', () => {
    expect(servingToday([turn('2026-10-03T13:00:00Z', 'RELEASED')], NY, now)).toEqual([]);
  });

  it('keeps one waiting on an organizer — it is still today, and still theirs', () => {
    expect(servingToday([turn('2026-10-03T13:00:00Z', 'CLAIMED')], NY, now)).toHaveLength(1);
  });

  it('judges the day in the co-op\'s timezone, not the reader\'s', () => {
    // 10pm in California is already the 4th in UTC. A member in California
    // must not be told that tomorrow's turn at the building is today.
    const tomorrowMorningNY = turn('2026-10-04T13:00:00Z');
    expect(servingToday([tomorrowMorningNY], NY, now)).toEqual([]);
  });

  it('leaves yesterday alone', () => {
    expect(servingToday([turn('2026-10-02T13:00:00Z')], NY, now)).toEqual([]);
  });

  it('puts the earliest turn first, for somebody with two', () => {
    const claims = [turn('2026-10-03T22:00:00Z', 'CONFIRMED', 'evening'), turn('2026-10-03T13:00:00Z', 'CONFIRMED', 'morning')];
    expect(servingToday(claims, NY, now).map((c) => c.id)).toEqual(['morning', 'evening']);
  });
});

describe('the link from Serve to My service', () => {
  it('says how many turns are waiting, so there is a reason to press it', () => {
    expect(myServiceLabel(3)).toContain('3');
  });

  it('still reads as a link when nothing is booked in', () => {
    expect(myServiceLabel(0)).toBe('My service');
  });

  it('is in the page header, not only in the banner that clears itself', () => {
    // The regression: the only route to My service was inside the transient
    // `notice`, so it vanished on the next action or reload.
    const page = readFileSync(
      join(__dirname, '..', 'app/(app)/portal/[orgSlug]/serve/page.tsx'),
      'utf8',
    );

    const header = page.slice(page.indexOf('<PageHeader'), page.indexOf('{notice &&'));
    expect(header).toContain('/service');
  });
});
