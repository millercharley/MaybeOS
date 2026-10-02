import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { RecapFigures } from '@/lib/api';
import {
  attendanceLine,
  dayOf,
  duesNote,
  hourLabel,
  monthOf,
  MONEY_SCOPE,
} from '@/lib/recap';

/**
 * The sentences the monthly recap's figures are shown under (RCP-01).
 *
 * The API goes to real trouble to be honest about three numbers it cannot
 * state plainly — who came, what the co-op took, and how far back the dues
 * record goes — and a confident label on the organiser's page would undo all
 * of it in a place nobody would look again. These are those labels.
 */
const FIGURES: RecapFigures = {
  monthLabel: 'September 2026',
  periodStart: '2026-09-01T04:00:00.000Z',
  periodEnd: '2026-10-01T04:00:00.000Z',
  members: { total: 48, joined: 3 },
  events: { hosted: 6, checkedIn: 0, eventsWithDoor: 0, expected: 0 },
  money: {
    month: { duesCents: 0, ticketsCents: 0, roomsCents: 0, totalCents: 0 },
    year: { duesCents: 0, ticketsCents: 0, roomsCents: 0, totalCents: 0 },
    duesRecordedSince: null,
  },
  service: null,
  impact: [],
};

const withEvents = (events: Partial<RecapFigures['events']>): RecapFigures['events'] => ({
  ...FIGURES.events,
  ...events,
});

describe('which attendance number the page shows', () => {
  it('shows the door count, and says that is what it is', () => {
    const line = attendanceLine(withEvents({ hosted: 6, checkedIn: 71, eventsWithDoor: 6 }));

    expect(line).toEqual({
      label: 'People at the door',
      value: 71,
      caveat: 'Recorded at the door.',
    });
  });

  it('says how many events the door count covers when it is not all of them', () => {
    // 71 people across two of six events is not the month's attendance, and
    // printed as "71" beside "6 events held" it reads as though it were.
    const line = attendanceLine(withEvents({ hosted: 6, checkedIn: 71, eventsWithDoor: 2 }));

    expect(line?.caveat).toContain('2 of the 6 events');
    expect(line?.caveat).toMatch(/nobody working one/);
  });

  it('falls back to RSVPs, named as intentions rather than attendance', () => {
    // A door nobody worked is not an event nobody came to. Showing the
    // check-in zero here would tell a co-op with full rooms that nobody came.
    const line = attendanceLine(withEvents({ hosted: 6, checkedIn: 0, expected: 54 }));

    expect(line?.label).toBe('People who said they were coming');
    expect(line?.value).toBe(54);
    expect(line?.caveat).toMatch(/who meant to come rather than who was there/);
  });

  it('shows nothing at all when neither number exists', () => {
    // A quiet month prints no attendance row. A zero under "people at the
    // door" is a verdict on the co-op rather than a fact about the data.
    expect(attendanceLine(withEvents({ hosted: 0, checkedIn: 0, expected: 0 }))).toBeNull();
  });
});

describe('what the money figures are said to cover', () => {
  it('names the three things MaybeOS sees and the ones it does not', () => {
    expect(MONEY_SCOPE).toMatch(/[Dd]ues, tickets and room hire/);
    expect(MONEY_SCOPE).toMatch(/[Cc]ash/);
    expect(MONEY_SCOPE).toMatch(/grants/);
    expect(MONEY_SCOPE).toMatch(/donations/);
  });

  it('notes where the dues record begins, when it begins inside the year shown', () => {
    const note = duesNote(
      {
        ...FIGURES,
        money: { ...FIGURES.money, duesRecordedSince: '2026-04-15T12:00:00.000Z' },
      },
      'America/New_York',
    );

    expect(note).toContain('April 15, 2026');
    expect(note).toMatch(/rather than from January/);
  });

  it('says nothing when dues were already being recorded before the year began', () => {
    // The year figure runs from January of the recap's own year. A first
    // payment in an earlier year means it covers the whole period, and a note
    // about it would be noise on every recap forever.
    expect(
      duesNote(
        {
          ...FIGURES,
          money: { ...FIGURES.money, duesRecordedSince: '2024-02-01T12:00:00.000Z' },
        },
        'America/New_York',
      ),
    ).toBeNull();
  });

  it('says nothing when no dues have ever been recorded', () => {
    expect(duesNote(FIGURES, 'America/New_York')).toBeNull();
  });

  it('reads the recap year off the month, not off the stored instant', () => {
    // January 2027 in Berlin starts at 23:00 on 31 December 2026 UTC. Reading
    // the year off the instant would compare against 2026 and suppress a note
    // the figure needs.
    const note = duesNote(
      {
        ...FIGURES,
        monthLabel: 'January 2027',
        periodStart: '2026-12-31T23:00:00.000Z',
        money: { ...FIGURES.money, duesRecordedSince: '2027-01-20T12:00:00.000Z' },
      },
      'Europe/Berlin',
    );

    expect(note).toContain('January 20, 2027');
  });
});

describe('dates and times, in the co-op’s own calendar', () => {
  it('files a month under the name the co-op would give it', () => {
    // The same instant is September east of UTC and August west of it. A
    // recap filed under the wrong month is wrong in the way nobody checks.
    expect(monthOf('2026-09-01T04:00:00.000Z', 'America/New_York')).toBe('September 2026');
    expect(monthOf('2026-08-31T22:00:00.000Z', 'Europe/Berlin')).toBe('September 2026');
  });

  it('falls back rather than failing on a timezone this browser never heard of', () => {
    // `Intl` throws RangeError on an unknown zone, and one bad co-op row must
    // not take down the page that would show it.
    expect(monthOf('2026-09-15T12:00:00.000Z', 'Mars/Olympus')).toBe('September 2026');
    expect(dayOf('2026-09-15T12:00:00.000Z', 'Mars/Olympus')).toBe('September 15, 2026');
  });

  it('says the hour the way an organizer would', () => {
    expect(hourLabel(0)).toBe('midnight');
    expect(hourLabel(9)).toBe('9am');
    expect(hourLabel(12)).toBe('noon');
    expect(hourLabel(19)).toBe('7pm');
  });
});

/**
 * The recap's two surfaces are actually rendered somewhere (RCP-01).
 *
 * Written for the same reason as `radar-reachable`: the member's switch
 * renders nothing when the co-op's plan does not include the recap, so an
 * unmounted one looks exactly like a co-op on Free. And the organiser's page
 * has an address that is already in email — the "your recap is ready" nudge
 * links to `/admin/{slug}/recap` — so a page at any other path is a 404 in
 * mail that has already been sent, with nothing failing anywhere.
 */
describe('the recap is wired to something', () => {
  const WEB_ROOT = join(__dirname, '..');
  const files: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry)) files.push(full);
    }
  };
  for (const root of ['app', 'components', 'lib']) walk(join(WEB_ROOT, root));

  it('the organizer’s page sits at the address the email links to', () => {
    const page = join(WEB_ROOT, 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'recap', 'page.tsx');

    expect(statSync(page).isFile()).toBe(true);
    expect(readFileSync(page, 'utf8')).toContain('api.recap.latest');
  });

  it('the navigation has a way in that does not come from an email', () => {
    expect(readFileSync(join(WEB_ROOT, 'lib', 'nav.ts'), 'utf8')).toContain('/recap');
  });

  it('the member’s switch is rendered by a page', () => {
    const definition = join('components', 'member', 'recap-emails.tsx');
    const renderers = files.filter(
      (file) =>
        relative(WEB_ROOT, file) !== definition &&
        /<RecapEmails\b/.test(readFileSync(file, 'utf8')),
    );

    if (renderers.length === 0) {
      throw new Error(
        'Nothing renders <RecapEmails />. It renders nothing when the co-op has no ' +
          'recap, so an unmounted one is invisible rather than broken.',
      );
    }
    expect(renderers.length).toBeGreaterThan(0);
  });
});
