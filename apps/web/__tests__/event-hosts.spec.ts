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
