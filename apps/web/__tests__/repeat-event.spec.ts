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

/**
 * Cloning, and the double opt-in (EVT-38).
 *
 * Charley: "add clone as its own button. Offer a double opt-in for cloning
 * events or room reservations that are recurring. Make sure the maximum an
 * event or room reservation can reoccur is one year."
 */
const clone = readFileSync(
  join(__dirname, '..', 'components', 'events', 'clone-event.tsx'),
  'utf8',
);

describe('cloning an event', () => {
  it('is its own button, beside Repeat', () => {
    expect(clone).toMatch(/Clone this event/);
    expect(overview).toMatch(/<CloneEvent orgId=\{orgId\} event=\{event\}/);
  });

  it('asks when the copy should be', () => {
    expect(clone).toMatch(/When should the copy be\?/);
  });

  it('previews before it writes', () => {
    expect(clone).toMatch(/Preview the copy/);
    expect(clone).toMatch(/run\(false\)/);
  });

  it('offers to hold the room, and says where it cannot', () => {
    expect(clone).toMatch(/Hold the same room/);
    expect(clone).toMatch(/already taken on the new date/);
  });
});

describe('the double opt-in', () => {
  it('asks which, when the event is one of a series', () => {
    // Somebody looking at one Tuesday of a weekly class cannot tell from the
    // screen whether Clone means that Tuesday or all fifty-two.
    expect(clone).toMatch(/needsScope && \(/);
    expect(clone).toMatch(/Just this one/);
    expect(clone).toMatch(/The whole series/);
  });

  it('asks a second time before copying the whole run', () => {
    expect(clone).toMatch(/scope === 'series' && \(/);
    expect(clone).toMatch(/Yes — copy all/);
    expect(clone).toMatch(/confirmSeries: true/);
  });

  it('does not ask twice about copying one', () => {
    // Undone by deleting a draft. Asking teaches people to click through the
    // question that matters.
    expect(clone).toMatch(/scope === 'series' && confirmed \? \{ confirmSeries: true \}/);
  });

  it('shows the API’s refusal, which names how many are involved', () => {
    expect(clone).toMatch(/err instanceof Error \? err\.message/);
  });
});

describe('a year, and no further', () => {
  it('says so in the repeat preview', () => {
    expect(panel).toMatch(/plan\.stopsAtAYear/);
    expect(panel).toMatch(/A repeat reaches one year/);
  });

  it('says what was left out of a cloned series', () => {
    expect(clone).toMatch(/droppedPastAYear > 0/);
    expect(clone).toMatch(/more than a year past the new start/);
  });

  it('tells somebody what to do about it', () => {
    expect(clone).toMatch(/Clone again from the last one to carry on/);
  });
});

describe('a long series is written in pieces', () => {
  it('carries on from where the API stopped', () => {
    // A year of a daily event is 366 events and 366 reservations.
    expect(panel).toMatch(/fromIndex = chunk\.next/);
    expect(panel).toMatch(/chunk\.next === null \|\| chunk\.next === undefined/);
  });

  it('cannot ask forever', () => {
    expect(panel).toMatch(/request < 20/);
  });

  it('adds up what each request made', () => {
    expect(panel).toMatch(/total\.occurrences \+ chunk\.occurrences/);
  });
});
