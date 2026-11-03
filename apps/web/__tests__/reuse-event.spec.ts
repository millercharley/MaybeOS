import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Starting a new event from one you already ran (EVT-48).
 *
 * Charley: "When a user creates a new event, provide an option to reuse a
 * previous event to pre-fill the event information (everything except the date
 * and the room). Provide a text-based search to find any event they were a
 * host or co-host. When there are events with the exact same title, consider
 * this the same event and simply provide the most recent event as the option
 * to select (instead of showing a list of the same title that could be 40
 * events long)."
 */
const strip = (s: string) => stripComments(s);

const picker = strip(
  readFileSync(join(__dirname, '..', 'components', 'events', 'reuse-event.tsx'), 'utf8'),
);
const form = strip(
  readFileSync(join(__dirname, '..', 'components', 'events', 'event-form.tsx'), 'utf8'),
);
const api = strip(readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8'));

describe('finding the event to copy', () => {
  it('is a search box, not a list of 767 rows', () => {
    // The Members page bug in a smaller box (MEM-22).
    expect(picker).toMatch(/type="search"/);
    expect(picker).not.toMatch(/<select/);
  });

  it('waits for a pause, so typing a name is one search', () => {
    expect(picker).toMatch(/setTimeout/);
    expect(picker).toMatch(/clearTimeout/);
  });

  it('ignores a slow search that lands after a later one', () => {
    expect(picker).toMatch(/mine === latest\.current/);
  });

  it('fetches nothing until it is opened', () => {
    expect(picker).toMatch(/if \(!open\) return;/);
  });

  it('shows the date each title last ran, with the year', () => {
    // Two similar names are told apart by when they ran, and these are years
    // apart by nature — "14 Oct" says nothing (SPC-23).
    expect(picker).toMatch(/\{lastRan\(event\.startTime\)\}/);
    expect(picker).toMatch(/year: 'numeric'/);
  });
});

describe('where the option appears', () => {
  it('is offered when making something new', () => {
    expect(form).toMatch(/<ReuseEvent/);
  });

  /*
    Charley: "it's actually important to offer the ability to clone the info
    while in the Edit mode for an event. The use case is for events that were
    migrated into a community from a calendar. All migrated events will need
    editing. I can imagine the member editing one event, then using the clone
    option to pre-fill the fields, image, etc. for each additional cloned
    event."

    It was held back from the edit form on the grounds that a control
    replacing a description would be a trap. Overruled, and rightly: it is
    two deliberate clicks deep, it writes nothing, and without it the 767
    events MaybeItsFate imported are 767 descriptions typed from scratch.
  */
  it('is offered while editing too, which is where a migration is fixed', () => {
    expect(form).toMatch(/\{orgId && token && \(/);
    expect(form).not.toMatch(/\{!initial\?\.id && orgId && token/);
  });

  it('tells the picker which mode it is in', () => {
    expect(form).toMatch(/editing=\{Boolean\(initial\?\.id\)\}/);
  });

  it('never offers the event being edited as its own source', () => {
    // Filling a form from the event it is already showing changes nothing,
    // and an option that does nothing reads as a broken one.
    expect(form).toMatch(/excludeId=\{initial\?\.id\}/);
    expect(picker).toMatch(/excludeId,/);
  });

  it('promises nothing is written until the member saves', () => {
    expect(picker).toMatch(/Nothing is written until you save/);
  });

  it('calls itself something different when filling in an existing event', () => {
    expect(picker).toMatch(/Fill these in from another event/);
    expect(picker).toMatch(/Start from a previous event/);
  });

  it('says afterwards which event it came from', () => {
    expect(form).toMatch(/Filled in from/);
  });
});

/**
 * Which of 46 identically-titled events is offered (EVT-48).
 *
 * The migration workflow decides this. Ordered by `startTime`, the single
 * option for "Board Games Club" was its latest-dated instance — which, part
 * way through editing 46 of them, is still the untouched import. The member
 * would copy the junk they were replacing, forty-five times.
 */
describe('which one it offers', () => {
  it('picks the one last written to, not the one dated latest', () => {
    const rule = readFileSync(
      join(__dirname, '..', '..', 'api', 'src', 'modules', 'events', 'reusable-events.ts'),
      'utf8',
    );

    expect(rule).toMatch(/event\.updatedAt > existing\.updatedAt/);
    expect(rule).not.toMatch(/event\.startTime > existing\.startTime/);
  });

  it('shows when it was last edited, so the member can see which one it is', () => {
    expect(picker).toMatch(/edited \{timeAgo\(event\.updatedAt\)\}/);
  });

  it('still shows its date, so two similar names can be told apart', () => {
    expect(picker).toMatch(/lastRan\(event\.startTime\)/);
  });
});

describe('what it fills in', () => {
  const carried = [
    ['the name', /setTitle\(event\.title\)/],
    ['what it is about', /setDescription\(event\.description/],
    ['the picture', /setImage\(\{/],
    ['where the picture is cropped', /setFocusY\(event\.imageFocusY/],
    ['who it is open to', /setVisibility\(event\.visibility/],
    ['how many people', /setCapacity\(event\.capacity/],
    ['the waitlist switch', /setWaitlist\(event\.waitlistEnabled/],
    ['the ticket price', /setPrice\(event\.priceCents/],
    ['the kinds of gathering', /setKinds\(event\.tags/],
    ['whether it costs', /setHasCost\(event\.hasCost/],
    ['the suggested amount', /setSuggested\(event\.suggestedCents/],
    ['who it is suitable for', /setMaturityLevel\(event\.maturityLevel/],
    ['the co-hosts', /setCoHosts\(/],
  ] as const;

  it.each(carried)('copies %s', (_what, pattern) => {
    expect(form).toMatch(pattern);
  });

  it('never copies when it is', () => {
    // A copy of last month's date is a mistake somebody has to notice.
    const fill = form.slice(form.indexOf('function fillFrom'));
    const body = fill.slice(0, fill.indexOf('\n  }'));

    expect(body).not.toMatch(/setStartTime/);
    expect(body).not.toMatch(/setEndTime/);
  });

  it('never copies where it is', () => {
    // A room is exclusive, so two evenings cannot share one reservation —
    // and on the publish-from-a-booking form those are what the booking is
    // supplying.
    const fill = form.slice(form.indexOf('function fillFrom'));
    const body = fill.slice(0, fill.indexOf('\n  }'));

    expect(body).not.toMatch(/setRooms/);
    expect(body).not.toMatch(/setRoomId/);
  });

  it('never copies who ran it', () => {
    // They host what they make (EVT-04), and this list includes events they
    // only co-hosted.
    const fill = form.slice(form.indexOf('function fillFrom'));
    const body = fill.slice(0, fill.indexOf('\n  }'));

    expect(body).not.toMatch(/setHostId/);
  });

  it('sets the empty fields too, rather than only the filled ones', () => {
    // Half of one event mixed with half of another is worse than either.
    expect(form).toMatch(/setDescription\(event\.description \?\? ''\)/);
    expect(form).toMatch(/setCapacity\(event\.capacity\?\.toString\(\) \?\? ''\)/);
  });
});

describe('the client', () => {
  it('has a route that takes the search text and the event to leave out', () => {
    expect(api).toMatch(/events\/reusable/);
    expect(api).toMatch(/params\.set\('q', q\)/);
    expect(api).toMatch(/params\.set\('exclude', excludeId\)/);
  });

  it('declares no address on a reused event', () => {
    const type = api.slice(api.indexOf('export interface ReusableEvent {'));
    expect(type.slice(0, type.indexOf('\n}'))).not.toMatch(/email/);
  });
});
