import { readFileSync } from 'fs';
import { join } from 'path';
import { hostLine, ticketLine } from '@/lib/event-list';

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

  it('lists every room it holds, not whether one is', () => {
    // An evening using the Attic and the Salon is two reservations and one
    // event (SPC-26).
    expect(overview).toMatch(/event\.rooms\?\.length/);
    expect(overview).toMatch(/'Rooms held' : 'Room held'/);
  });

  it('says when a reservation is not confirmed yet', () => {
    // A room "held" by a pending booking is not held.
    expect(overview).toMatch(/awaiting approval/);
  });

  it('says what a ticket costs, and distinguishes paying at the door', () => {
    // `hasCost` is money the host takes themselves; `priceCents` is a ticket
    // sold through MaybeOS, and they are not the same question. EVT-34 gave
    // the first of them an optional figure.
    expect(overview).toMatch(/event\.priceCents/);
    expect(overview).toMatch(/Pay or donate at the door/);
    expect(overview).toMatch(/suggested at the door/);
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

  it('is on the host’s own copy, with the takings', () => {
    /*
      The takings used to stay with organisers, and this test pinned that.
      Charley, 2026-10-04: "When a member is selling tickets to an event they
      are hosting or co-hosting, they need visibility into ticket sales, who
      bought tickets, and an option to refund a person."

      So the rule inverted (EVT-41), and the reason is that the person a
      buyer asks for their money back is the host — a host who has to go and
      find an organiser is a host who stops selling tickets. The API checks
      the same thing again; this flag only chooses what to draw.
    */
    const hostPage = readFileSync(
      join(WEB, 'app', '(app)', '(dashboard)', 'member', '[orgSlug]', 'events', '[eventId]', 'page.tsx'),
      'utf8',
    );

    expect(hostPage).toMatch(/overviewFor=\{orgSlug\}/);
    expect(hostPage).toMatch(/showTickets/);
  });
});

describe('the events list', () => {
  it('opens on what is coming', () => {
    expect(listPage).toMatch(/useState<FilterTab>\('upcoming'\)/);
  });
});

/**
 * Acting on an event from the page you opened to look at it (EVT-35).
 *
 * Edit, Hide and Delete lived only on the Events list, so an organiser who
 * had opened an event had to go back to change anything about it.
 */
describe('what can be done from the event page', () => {
  it('offers Edit, Hide and Delete', () => {
    expect(overview).toMatch(/> Edit\n/);
    expect(overview).toMatch(/> Hide\n/);
    expect(overview).toMatch(/> Delete\n/);
  });

  it('does not offer to hide one that is already hidden', () => {
    expect(overview).toMatch(/\{event\.isPublished && \(/);
  });

  it('asks before deleting, and says what to do instead', () => {
    expect(overview).toMatch(/This cannot be undone/);
    expect(overview).toMatch(/hide or cancel it instead/);
  });

  it('leaves the page once the event is gone', () => {
    // The page it was on no longer describes anything.
    expect(overview).toMatch(/router\.push\(backHref\)/);
  });

  it('opens the edit form rather than only going back', () => {
    expect(doorList).toMatch(/\$\{backHref\}\?edit=\$\{event\.id\}/);
  });

  it('keeps hiding and deleting with organisers', () => {
    expect(doorList).toMatch(/canRemove=\{showTickets\}/);
  });
});

describe('who is running it, in one line', () => {
  it('names the host', () => {
    expect(hostLine({ host: { name: 'Ada' } })).toBe('Ada');
  });

  it('names both when there are two', () => {
    expect(hostLine({ host: { name: 'Ada' }, coHosts: [{ user: { name: 'Bo' } }] })).toBe(
      'Ada and Bo',
    );
  });

  it('counts the rest past that, rather than filling the card', () => {
    expect(
      hostLine({
        host: { name: 'Ada' },
        coHosts: [{ user: { name: 'Bo' } }, { user: { name: 'Cy' } }],
      }),
    ).toBe('Ada and 2 others');
  });

  it('uses the name an imported event kept for a host who left', () => {
    expect(hostLine({ host: null, hostName: 'Sam Mullooly' })).toBe('Sam Mullooly');
  });

  it('says so when nobody is set', () => {
    expect(hostLine({})).toBe('No host set');
  });
});

describe('how ticket sales read', () => {
  it('counts against capacity when there is one', () => {
    expect(ticketLine({ priceCents: 1500, ticketsSold: 12, capacity: 40 })).toBe(
      '12 of 40 tickets sold',
    );
  });

  it('counts alone when there is no capacity', () => {
    expect(ticketLine({ priceCents: 1500, ticketsSold: 1 })).toBe('1 ticket sold');
  });

  it('says nothing about an event with no tickets', () => {
    expect(ticketLine({ ticketsSold: 0 })).toBeNull();
  });
});
