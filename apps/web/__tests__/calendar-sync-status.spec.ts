import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The unattended sync has to be visible (CAL-13).
 *
 * A field nobody reads is the same as no field — which is exactly what
 * `isFlagged` turned out to be in the Commons, written by two methods and read
 * by none. The whole premise of running the calendar sync unattended is that
 * nobody is watching it, so a sync failing all week against a revoked Google
 * token must not look like a sync with nothing to do.
 */
const panel = stripComments(readFileSync(
  join(__dirname, '..', 'components', 'settings', 'calendar-import.tsx'),
  'utf8',
));

describe('the import panel', () => {
  it('asks how the automatic sync is getting on', () => {
    expect(panel).toMatch(/api\.calendar\.syncStatus\(org\.id, token\)/);
  });

  it('never lets that break the panel', () => {
    // The manual import still works whether or not the status answers.
    expect(panel).toMatch(/syncStatus\(org\.id, token\)\.then\(setSync\)\.catch\(/);
  });

  it('says plainly when the sync is failing, and what to do', () => {
    expect(panel).toMatch(/The automatic sync is failing/);
    expect(panel).toMatch(/Reconnecting the room/);
  });

  it('treats a pass in flight as progress, not as never having run', () => {
    // Nine calendars do not finish in one tick, so this is most of the time.
    expect(panel).toMatch(/working through the rest now/);
    expect(panel).toMatch(/Working through your calendars for the first time/);
  });

  it('says nothing at all when no calendar is connected', () => {
    // Nothing syncs itself yet, and an empty date would imply it should have.
    expect(panel).toMatch(/sync\?\.automatic && \(/);
  });

  it('tells the admin what pressing the button is now for', () => {
    /*
      It used to be the only thing that ever read Google. It is now the way to
      not wait — and the wait is honestly described, because it is hours and
      not minutes: MaybeItsFate's pass moves about forty-eight entries a tick
      across nine calendars.
    */
    expect(panel).toMatch(/continuously in the background/);
    expect(panel).toMatch(/takes a few hours/);
    expect(panel).toMatch(/how you stop waiting/);
  });
});

/**
 * A sync that has stopped finishing, and has not said why (CAL-15).
 *
 * This box had one way to report trouble: `error`, written by an
 * `organization.update`. For five days the sync was failing on an
 * `organization.update` against a column the database did not have (OPS-42),
 * so the field stayed null, the box stayed grey, and it read "Last synced
 * itself 06/11/2026" while every tick failed. 589 Sentry warnings and nothing
 * on the screen.
 */
describe('when the sync has gone quiet', () => {
  const panel = readFileSync(
    join(__dirname, '..', 'components', 'settings', 'calendar-import.tsx'),
    'utf8',
  );

  it('turns the box amber on staleness, not only on a recorded error', () => {
    expect(panel).toMatch(/sync\.error \|\| sync\.stale \? 'bg-amber-50/);
  });

  it('says it has stopped finishing, and when it last did', () => {
    expect(panel).toMatch(/The automatic sync has stopped finishing/);
    expect(panel).toMatch(/last\s*\n?\s*complete pass was/);
  });

  it('says what that costs, since the date alone did not land', () => {
    expect(panel).toMatch(/Nothing new from your calendars has/);
  });

  it('still prefers the recorded reason when there is one', () => {
    // Google's own message is more useful than "it stopped".
    expect(panel.indexOf('sync.error ? (')).toBeLessThan(panel.indexOf('sync.stale ? ('));
  });

  it('keeps the calm line for a sync that is simply working', () => {
    expect(panel).toMatch(/Last synced itself/);
    expect(panel).toMatch(/working through the rest now/);
  });
});
