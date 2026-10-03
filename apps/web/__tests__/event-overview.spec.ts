import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * What an organiser sees when they open an event (EVT-31).
 *
 * The admin's event page was the door list and nothing else — a check-in
 * screen reached from a card carrying a title, a date and an RSVP count.
 * Charley, opening one of 777 imported events: "make sure the full details
 * for the event are reviewable, including who the host is with an option to
 * DM this person. Show ticket sales, room(s) booked, anything related."
 */

const WEB = join(__dirname, '..');
const overview = readFileSync(join(WEB, 'components', 'events', 'event-overview.tsx'), 'utf8');
const doorList = readFileSync(join(WEB, 'components', 'events', 'door-list.tsx'), 'utf8');
const adminPage = readFileSync(
  join(WEB, 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'events', '[eventId]', 'page.tsx'),
  'utf8',
);
const listPage = readFileSync(
  join(WEB, 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'events', 'page.tsx'),
  'utf8',
);

describe('the host', () => {
  it('is named, and opens their member card', () => {
    expect(overview).toMatch(/<MemberName userId=\{event\.host\.id\}/);
  });

  it('can be messaged without going to find them', () => {
    expect(overview).toMatch(/\/portal\/\$\{orgSlug\}\/messages\/\$\{event\.host\.id\}/);
    expect(overview).toMatch(/Message them/);
  });

  it('says plainly when the host is not a member here', () => {
    // An imported event whose host has left keeps their name and has nobody
    // to message (CAL-03).
    expect(overview).toMatch(/not a member here, so there is nobody to message/);
  });

  it('says when nobody is set, rather than leaving a gap', () => {
    expect(overview).toMatch(/Nobody is set as the host/);
  });
});

describe('what else is on it', () => {
  it('says where, including the room', () => {
    expect(overview).toMatch(/event\.room\?\.name/);
    expect(overview).toMatch(/label="Where"/);
  });

  it('says whether a room is held for it', () => {
    expect(overview).toMatch(/label="Room booking"/);
  });

  it('says what a ticket costs, and distinguishes cash at the door', () => {
    // `hasCost` is money the host takes themselves; `priceCents` is a ticket
    // sold through MaybeOS, and they are not the same question.
    expect(overview).toMatch(/event\.priceCents/);
    expect(overview).toMatch(/Charged at the door, not through MaybeOS/);
  });

  it('totals the sales, leaving refunds out of what was taken', () => {
    expect(overview).toMatch(/filter\(\(t\) => !t\.refundedAt\)/);
    expect(overview).toMatch(/taken/);
  });

  it('counts RSVPs against capacity', () => {
    expect(overview).toMatch(/event\.rsvpCount/);
    expect(overview).toMatch(/event\.capacity/);
  });

  it('draws all three visibilities', () => {
    for (const word of ['Public', 'Members only', 'Private']) {
      expect(overview).toContain(word);
    }
  });

  it('says whether members can see it at all', () => {
    expect(overview).toMatch(/Hidden/);
    expect(overview).toMatch(/Published/);
  });
});

describe('where it is rendered', () => {
  it('is on the organiser’s event page', () => {
    expect(adminPage).toMatch(/overviewFor=\{orgSlug\}/);
  });

  it('reuses the event the door list already loaded', () => {
    // A second fetch would be a second source of truth for the same screen.
    expect(doorList).toMatch(/<EventOverview\s+event=\{event\}/);
  });

  it('is not on the host’s copy, which is only the door', () => {
    // A host stands at the door with one hand free; they do not need the
    // ticket takings above the list of names.
    expect(doorList).toMatch(/\{overviewFor && event && \(/);

    const hostPage = readFileSync(
      join(WEB, 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'events', '[eventId]', 'page.tsx'),
      'utf8',
    );
    expect(hostPage).not.toMatch(/overviewFor/);
  });
});

describe('the events list', () => {
  it('opens on what is coming', () => {
    expect(listPage).toMatch(/useState<FilterTab>\('upcoming'\)/);
  });
});
