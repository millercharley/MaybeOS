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
    expect(picker).toMatch(/last on \{lastRan/);
    expect(picker).toMatch(/year: 'numeric'/);
  });
});

describe('where the option appears', () => {
  it('is offered when making something new', () => {
    expect(form).toMatch(/<ReuseEvent/);
  });

  it('is not offered while editing an event', () => {
    /*
      Editing is correcting this one. A control that silently replaced its
      description with another event's would be a trap on the screen somebody
      opened to fix a typo.
    */
    expect(form).toMatch(/\{!initial\?\.id && orgId && token && \(/);
  });

  it('says afterwards which event it came from', () => {
    expect(form).toMatch(/Filled in from/);
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
  it('has a route that takes the search text', () => {
    expect(api).toMatch(/events\/reusable/);
    expect(api).toMatch(/encodeURIComponent\(q\)/);
  });

  it('declares no address on a reused event', () => {
    const type = api.slice(api.indexOf('export interface ReusableEvent {'));
    expect(type.slice(0, type.indexOf('\n}'))).not.toMatch(/email/);
  });
});
