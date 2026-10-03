import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Repeating an event, and cloning one (EVT-37).
 *
 * Charley: model it after Google Calendar. "The trick in MaybeOS is for some
 * communities, this means the member might need to also reserve a room(s) on
 * a recurring basis."
 */

const panel = readFileSync(
  join(__dirname, '..', 'components', 'events', 'repeat-event.tsx'),
  'utf8',
);
const overview = readFileSync(
  join(__dirname, '..', 'components', 'events', 'event-overview.tsx'),
  'utf8',
);

describe('the repeat controls', () => {
  it('asks the way Google asks: every n of something', () => {
    for (const unit of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']) {
      expect(panel).toContain(unit);
    }
    expect(panel).toMatch(/Repeat every/);
  });

  it('offers days of the week for a weekly repeat', () => {
    expect(panel).toMatch(/frequency === 'WEEKLY' && \(/);
    expect(panel).toMatch(/Repeat on/);
  });

  it('will not let every day be turned off', () => {
    // Nothing to repeat, and the API would quietly pick one anyway.
    expect(panel).toMatch(/current\.length === 1/);
  });

  it('ends after a count or on a date', () => {
    expect(panel).toMatch(/checked=\{ends === 'count'\}/);
    expect(panel).toMatch(/checked=\{ends === 'on'\}/);
  });

  it('says plainly why there is no "never"', () => {
    // Google can repeat forever because it stores a rule. Each of these is a
    // real event with its own RSVPs and its own room.
    expect(panel).toMatch(/no &ldquo;never&rdquo;/);
  });
});

describe('the rooms, which is the hard part', () => {
  it('offers to hold the room each time, only when one is held', () => {
    expect(panel).toMatch(/holdsRooms && \(/);
    expect(panel).toMatch(/Hold the room each time/);
  });

  it('says how many dates the room is already taken on', () => {
    expect(panel).toMatch(/plan\.roomClashes > 0/);
    expect(panel).toMatch(/already taken/);
  });

  it('says what happened to those dates afterwards, rather than burying it', () => {
    expect(panel).toMatch(/done\.roomClashes > 0/);
    expect(panel).toMatch(/book a different room/);
  });
});

describe('before anything is written', () => {
  it('previews first', () => {
    expect(panel).toMatch(/Preview the dates/);
    expect(panel).toMatch(/run\(true\)/);
  });

  it('only writes once a preview exists', () => {
    expect(panel).toMatch(/plan \? \(/);
    expect(panel).toMatch(/run\(false\)/);
  });

  it('says the series arrives as drafts', () => {
    // Fifty-two evenings announced into the Commons at once would be a bad
    // afternoon for everybody (EVT-23).
    expect(panel).toMatch(/nobody is told until you publish/);
  });

  it('does not offer to make nothing', () => {
    expect(panel).toMatch(/plan\.occurrences === 0/);
  });
});

describe('where it lives', () => {
  it('is on the event page, for whoever may run the event', () => {
    expect(overview).toMatch(/<RepeatEvent orgId=\{orgId\} event=\{event\}/);
    expect(overview).toMatch(/\{canManageHosts && orgId && \(/);
  });
});
