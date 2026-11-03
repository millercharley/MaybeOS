import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Handing somebody's events to the member who runs them (EVT-47).
 *
 * Charley: "As an admin, I want to transfer events to a new owner. From the
 * calendar migration, I have a lot of events in MaybeItsFate that are still
 * owned by me (c@maybeitsfate.com) that I want to remove from My Events and
 * make sure the real member who manages the event see all of this recurring
 * event listed under their My Events to manage."
 */
const strip = (s: string) => stripComments(s);

const panel = strip(
  readFileSync(join(__dirname, '..', 'components', 'events', 'transfer-events.tsx'), 'utf8'),
);
const admin = strip(
  readFileSync(
    join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'events', 'page.tsx'),
    'utf8',
  ),
);
const api = strip(readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8'));

describe('getting to it', () => {
  it('is offered on the admin events page', () => {
    expect(admin).toMatch(/Transfer events/);
    expect(admin).toMatch(/<TransferEvents/);
  });

  it('reloads the list afterwards, since the host column has changed', () => {
    expect(admin).toMatch(/onDone=\{refetch\}/);
  });
});

describe('what it asks, and in what order', () => {
  it('asks whose events before anything else', () => {
    // MaybeOS cannot answer this: `hostEmail` is null on all 769, so there is
    // no imported organiser to fall back on and nothing to guess from.
    expect(panel).toMatch(/Whose events\?/);
    expect(panel.indexOf('Whose events?')).toBeLessThan(panel.indexOf('Who runs '));
  });

  it('asks who runs it per series, not once for everything', () => {
    // Board Games Club is one member's and Improv Club is another's.
    expect(panel).toMatch(/Who runs \{group\.title\}\?/);
  });

  it('does not offer handing a series back to the person who holds it', () => {
    expect(panel).toMatch(/exclude=\{from \? \[from\.user\.id\] : \[\]\}/);
  });
});

describe('what it shows about a series', () => {
  it('counts the dates and says how many are still to come', () => {
    expect(panel).toMatch(/still to come/);
    expect(panel).toMatch(/all in the past/);
  });

  it('spans the years, so a series that ended in 2025 is not taken for a live one', () => {
    expect(panel).toMatch(/first === last \? `\$\{first\}` : `\$\{first\}–\$\{last\}`/);
  });

  it('says which dates will not move before anything is sent', () => {
    // The refusal reason comes from the same rule the write uses, so a
    // preview cannot promise something the write then refuses (EVT-15).
    expect(panel).toMatch(/will stay/);
    expect(panel).toMatch(/group\.blocked\[0\]\.reason/);
  });

  it('says past dates are included, which is the point', () => {
    // "see all of this recurring event listed under their My Events" — half a
    // series is not somebody's history.
    expect(panel).toMatch(/past\s*\n?\s*ones included|past ones included/);
  });
});

describe('what it sends', () => {
  it('names the events by id, not by title', () => {
    /*
      The admin approved a list they were shown. Sending the title would
      re-run the search at write time and could move something created in
      between — which the API would accept, because it would still be one of
      theirs.
    */
    expect(panel).toMatch(/eventIds: group\.eventIds/);
    expect(panel).not.toMatch(/title: group\.title,\s*\n\s*\}/);
  });

  it('says who they came from, so the server can check every id', () => {
    expect(panel).toMatch(/fromUserId: from\.user\.id/);
    expect(panel).toMatch(/toUserId: to\.user\.id/);
  });

  it('reports what was refused rather than claiming it all moved', () => {
    expect(panel).toMatch(/result\.refused\.length === 0/);
    expect(panel).toMatch(/left where/);
  });
});

describe('the client', () => {
  it('has a route for the grouped list and one for the transfer', () => {
    expect(api).toMatch(/events\/owned-by\/\$\{userId\}/);
    expect(api).toMatch(/events\/transfer-host/);
  });

  it('declares the refusals, so a caller has to deal with them', () => {
    expect(api).toMatch(/refused: \{ id: string; reason: string \}\[\]/);
  });
});
