import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Switching the host, and adding co-hosts (EVT-32).
 *
 * Charley: "The admin needs the ability to switch the host and add co-hosts.
 * Make sure the member who created the event also has the ability... Make
 * sure it's easy to start typing the name of a member and a list appears of
 * matches as the person types."
 */

const WEB = join(__dirname, '..');
const picker = readFileSync(join(WEB, 'components', 'member', 'member-picker.tsx'), 'utf8');
const overview = readFileSync(join(WEB, 'components', 'events', 'event-overview.tsx'), 'utf8');
const doorList = readFileSync(join(WEB, 'components', 'events', 'door-list.tsx'), 'utf8');

describe('typing a name', () => {
  it('searches the whole roster, not a page of it', () => {
    // MaybeItsFate has 437 members. A picker filtering the first twenty
    // would be the Members page bug in a smaller box (MEM-22).
    expect(picker).toMatch(/api\.members\.list\(orgId, token, 1, 8, text\)/);
  });

  it('waits a moment, so a name is one search and not eight', () => {
    expect(picker).toMatch(/setTimeout\(/);
  });

  it('needs two letters before it asks anything', () => {
    expect(picker).toMatch(/text\.length < 2/);
  });

  it('ignores an answer that arrives after a later one', () => {
    // A slow early request landing last would replace the right answer with
    // a stale one — the classic typeahead bug.
    expect(picker).toMatch(/mine === latest\.current/);
  });

  it('says when nobody matches, rather than showing an empty box', () => {
    expect(picker).toMatch(/Nobody by that name/);
  });

  it('leaves out people already on the event', () => {
    expect(picker).toMatch(/exclude\.includes\(m\.user\.id\)/);
    expect(picker).toMatch(/already on this event/);
  });
});

describe('the controls', () => {
  it('can hand the event to somebody else', () => {
    expect(overview).toMatch(/api\.events\.setHost\(/);
    expect(overview).toMatch(/Change host/);
  });

  it('can add and remove a co-host', () => {
    expect(overview).toMatch(/api\.events\.addCoHost\(/);
    expect(overview).toMatch(/api\.events\.removeCoHost\(/);
  });

  it('does not offer the host as their own co-host', () => {
    expect(overview).toMatch(/exclude=\{\[\s*\.\.\.\(event\.host\?\.id \? \[event\.host\.id\] : \[\]\)/);
  });

  it('lets a co-host be messaged, like the host', () => {
    expect(overview).toMatch(/messages\/\$\{co\.userId\}/);
  });

  it('shows the API’s refusal rather than a generic failure', () => {
    // It says who may change this, which is the useful part.
    expect(overview).toMatch(/err instanceof Error \? err\.message : 'That did not work'/);
  });

  it('reloads the event after a change', () => {
    expect(doorList).toMatch(/onChanged=\{load\}/);
  });

  it('says plainly when nobody else is running it', () => {
    expect(overview).toMatch(/Nobody else is running this one/);
  });
});

describe('who sees the controls', () => {
  it('an organiser, on the admin page', () => {
    expect(doorList).toMatch(/showTickets \|\|/);
  });

  it('the host or the creator, on their own copy', () => {
    expect(doorList).toMatch(/me === event\.host\?\.id \|\| me === event\.createdById/);
  });
});

/**
 * What a host or co-host can do with their own event (EVT-33).
 *
 * Charley: "any host, co-host and admin can edit the title, image, and
 * description… change any detail… add ticketing or manage the ticketing, and
 * reviewing who has bought tickets."
 */
describe('a host’s own event page', () => {
  it('asks for the ticket sales, which were organisers-only', () => {
    expect(doorList).toMatch(/showTickets \|\| hostsIfMine/);
  });

  it('survives being refused them', () => {
    // The API still refuses anybody who does not run the event, and a 403
    // must not take the door list down with it.
    expect(doorList).toMatch(/setTickets\(\[\]\)/);
  });

  it('shows the sales list to whoever runs it', () => {
    expect(doorList).toMatch(/\(showTickets \|\| hostsIfMine\) && tickets\.length > 0/);
  });

  it('keeps refunding with organisers', () => {
    // A host can see who paid, because knowing who is coming is most of
    // running an event. The money went to the co-op's Stripe account, and
    // sending it back out is the co-op's decision.
    const refundBlock = doorList.slice(doorList.indexOf('Refunded {new Date'));

    expect(refundBlock).toMatch(/showTickets && \(/);
  });
});
