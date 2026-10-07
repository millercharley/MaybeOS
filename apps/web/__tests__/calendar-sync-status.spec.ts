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
const panel = readFileSync(
  join(__dirname, '..', 'components', 'settings', 'calendar-import.tsx'),
  'utf8',
)
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\/.*$/gm, '');

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
    // It used to be the only thing that ever read Google.
    expect(panel).toMatch(/about once an hour/);
  });
});
